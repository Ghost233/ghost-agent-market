import { readFileSync, watch } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'ghost-home-repo';
export const inject = ['skills'];

// ---------- 内置 skill（插件自带，静态注册） ----------
const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));
const bundledCandidates = catalog.skills.map(({ name, description, invocation }) => ({
  name, description, invocation,
  provider: 'ghost-home-repo', source: 'bundled', rank: 600,
  resourceBase: { kind: 'directory', path: fileURLToPath(new URL(`./skills/${name}/`, import.meta.url)) },
  locator: new URL(`./skills/${name}/SKILL.md`, import.meta.url),
}));

// ---------- 子仓库 skill 发现（动态 Provider，决策见 docs/adr/0001） ----------
const SKIP_TOP = new Set(['node_modules']);
const RANK_REPO_DSH = 150;    // 子仓库 .dsh/skills（对应 DSH 原生 project-dsh=100 的相对次序）
const RANK_REPO_AGENTS = 250; // 子仓库 .agents/skills（对应原生 project-agents=200）
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// 名称归一化（ADR 0001 D2）：转小写 → 仅保留 [a-z] 与连字符 → 合并连续连字符 → 去首尾连字符。
// 不分词、不拆驼峰：GhostCodexSentinel → ghostcodexsentinel；Ghost-Codex-Sentinel → ghost-codex-sentinel。
function normalizePrefix(dirName) {
  return dirName.toLowerCase().replace(/[^a-z-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
}

// 读 SKILL.md frontmatter 的 name/description（仅取头部 4KB，单行 YAML 子集）
async function readFrontmatter(file) {
  let raw;
  try { raw = await readFile(file, 'utf8'); } catch { return undefined; }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw.slice(0, 4096));
  if (!m) return undefined;
  const field = (key) => {
    const r = new RegExp(`^${key}:\\s*(.+)\\s*$`, 'm').exec(m[1]);
    return r ? r[1].replace(/^["']|["']$/g, '') : undefined;
  };
  return { name: field('name'), description: field('description') };
}

// 扫描 cwd 一层子目录中的 .dsh/skills 与 .agents/skills（ADR 0001 D5，黑名单制）
async function scanRepoSkills(cwd, warn) {
  let top;
  try { top = await readdir(cwd, { withFileTypes: true }); } catch { return { candidates: [], watchDirs: [] }; }
  const candidates = [];
  const watchDirs = [];
  const seen = new Set();
  for (const entry of top) {
    if (!entry.isDirectory()) continue;
    const repo = entry.name;
    if (repo.startsWith('.') || repo.endsWith('.worktrees') || SKIP_TOP.has(repo)) continue;
    const prefix = normalizePrefix(repo);
    if (!prefix) continue;
    for (const [metaDir, rank] of [['.dsh', RANK_REPO_DSH], ['.agents', RANK_REPO_AGENTS]]) {
      const metaRoot = join(cwd, repo, metaDir);
      const skillsRoot = join(metaRoot, 'skills');
      let dirs;
      try { dirs = await readdir(skillsRoot, { withFileTypes: true }); } catch { continue; }
      watchDirs.push(metaRoot); // 监听 meta 目录（递归），覆盖 skills/ 的新建与变更
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const skillFile = join(skillsRoot, d.name, 'SKILL.md');
        const fm = await readFrontmatter(skillFile);
        if (!fm) continue;
        const skillName = fm.name && KEBAB.test(fm.name) ? fm.name : normalizePrefix(d.name);
        if (!skillName) continue;
        const fullName = `${prefix}-${skillName}`;
        if (seen.has(fullName)) { warn(`ghost-home-repo: 跳过重复的子仓库 skill ${fullName}（${skillFile}）`); continue; }
        seen.add(fullName);
        candidates.push({
          name: fullName,
          description: `[${repo}] ${fm.description ?? ''}`.trim(),
          invocation: { modelInvocable: true, userInvocable: true }, // ADR 0001 D4：允许模型路由
          provider: 'ghost-home-repo', source: 'custom', rank,
          resourceBase: { kind: 'directory', path: dirname(skillFile) },
          locator: skillFile,
        });
      }
    }
  }
  return { candidates, watchDirs };
}

export function apply(ctx) {
  const warn = (msg) => { try { ctx.logger?.warn?.(msg); } catch { console.warn(msg); } };
  ctx.skills.registerProvider((control) => {
    const watchers = new Map(); // cwd -> FSWatcher[]
    const timers = new Map();   // cwd -> debounce timer

    const rearm = (cwd) => {
      for (const w of watchers.get(cwd) ?? []) { try { w.close(); } catch { /* noop */ } }
      watchers.delete(cwd);
      control.invalidate(); // registry 重新 list，届时会再次 armWatchers
    };
    const scheduleInvalidate = (cwd) => {
      clearTimeout(timers.get(cwd));
      const timer = setTimeout(() => rearm(cwd), 300);
      timer.unref?.(); // 防抖计时器同样不拖累进程退出
      timers.set(cwd, timer);
    };
    const armWatchers = (cwd, dirs) => {
      if (watchers.has(cwd)) return;
      const ws = [];
      // cwd 根目录非递归监听：捕捉新增/删除一层子目录（新仓库入库）
      try {
        const rootWatcher = watch(cwd, () => scheduleInvalidate(cwd));
        rootWatcher.on('error', () => { /* noop */ });
        rootWatcher.unref?.(); // 不拖累宿主进程退出
        ws.push(rootWatcher);
      } catch { /* noop */ }
      for (const dir of dirs) {
        try {
          const w = watch(dir, { recursive: true }, () => scheduleInvalidate(cwd));
          w.on('error', () => { /* 目录被删等错误忽略，靠 invalidate 重建 */ });
          w.unref?.(); // 不拖累宿主进程退出
          ws.push(w);
        } catch { /* noop */ }
      }
      watchers.set(cwd, ws);
    };
    control.signal.addEventListener('abort', () => {
      for (const ws of watchers.values()) for (const w of ws) { try { w.close(); } catch { /* noop */ } }
      for (const t of timers.values()) clearTimeout(t);
      watchers.clear();
      timers.clear();
    });

    return {
      name: 'ghost-home-repo',
      async list(options) {
        const cwd = options?.cwd;
        if (!cwd) return bundledCandidates;
        const { candidates, watchDirs } = await scanRepoSkills(cwd, warn);
        armWatchers(cwd, watchDirs);
        return [...bundledCandidates, ...candidates];
      },
      async get(candidate) {
        const path = typeof candidate.locator === 'string' ? candidate.locator : fileURLToPath(candidate.locator);
        const markdown = await readFile(path, 'utf8');
        const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(markdown);
        if (!match) throw new Error(`Invalid skill frontmatter: ${candidate.name}`);
        return { ...candidate, content: markdown.slice(match[0].length) };
      },
    };
  });
}
