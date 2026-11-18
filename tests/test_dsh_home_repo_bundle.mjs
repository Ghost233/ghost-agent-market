// dsh-ghost-home-repo 子仓库 skill 发现 Provider 冒烟测试。
// 由 .github/workflows/release-dsh-home-repo.yml 在 validate 阶段执行。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'homerepo-test-'));

// 仓库 A：.agents/skills/deploy-release
mkdirSync(join(root, 'GhostNexus', '.agents', 'skills', 'deploy-release'), { recursive: true });
writeFileSync(join(root, 'GhostNexus', '.agents', 'skills', 'deploy-release', 'SKILL.md'),
  '---\nname: deploy-release\ndescription: 发布 Nexus 到生产环境\n---\n\n步骤一\n');
// 仓库 B：.dsh/skills/deploy-release（同名 skill，靠前缀区分）
mkdirSync(join(root, 'GhostModelDeck', '.dsh', 'skills', 'deploy-release'), { recursive: true });
writeFileSync(join(root, 'GhostModelDeck', '.dsh', 'skills', 'deploy-release', 'SKILL.md'),
  '---\nname: deploy-release\ndescription: 打包并发布 ModelDeck\n---\n\n步骤 X\n');
// 仓库 C：特殊字符目录名（归一化：Ghost你好123-Codex!@#Sentinel → ghost-codexsentinel）
mkdirSync(join(root, 'Ghost你好123-Codex!@#Sentinel', '.agents', 'skills', 'lint'), { recursive: true });
writeFileSync(join(root, 'Ghost你好123-Codex!@#Sentinel', '.agents', 'skills', 'lint', 'SKILL.md'),
  '---\nname: lint\ndescription: 跑 lint\n---\n\nlint 正文\n');
// 应被跳过：worktrees、node_modules、隐藏目录
for (const bad of ['GhostNexus.worktrees/fix-1', 'node_modules/pkg', '.hidden']) {
  mkdirSync(join(root, bad, '.agents', 'skills', 'x'), { recursive: true });
  writeFileSync(join(root, bad, '.agents', 'skills', 'x', 'SKILL.md'), '---\nname: x\ndescription: y\n---\n');
}

const plugin = await import(new URL('../dsh-market/ghost-home-repo/index.mjs', import.meta.url));
let provider;
const ac = new AbortController();
const fakeCtx = {
  skills: { registerProvider(create) { provider = create({ signal: ac.signal, invalidate() {} }); } },
  logger: console,
};
plugin.apply(fakeCtx);

const list = await provider.list({ cwd: root });
const names = list.map((c) => c.name);

// 发现与命名
assert.ok(names.includes('ghostnexus-deploy-release'), '发现 GhostNexus 的 deploy-release');
assert.ok(names.includes('ghostmodeldeck-deploy-release'), '发现 GhostModelDeck 的同名 deploy-release');
assert.ok(names.includes('ghost-codexsentinel-lint'), '特殊字符目录名归一化');
// 排除规则
assert.ok(!names.some((n) => n.includes('worktrees') || n.endsWith('-x')), '排除 worktrees/node_modules/隐藏目录');
// 内置 skill 保留
assert.ok(names.includes('home-repo-init') && names.includes('home-repo-coordinate'), '内置 skill 保留');
// 描述带仓库标签，rank 区分 .dsh/.agents
const nexus = list.find((c) => c.name === 'ghostnexus-deploy-release');
assert.equal(nexus.description, '[GhostNexus] 发布 Nexus 到生产环境');
assert.equal(nexus.rank, 250);
const deck = list.find((c) => c.name === 'ghostmodeldeck-deploy-release');
assert.equal(deck.rank, 150);
// get() 懒加载正文（去掉 frontmatter）
const def = await provider.get(nexus, { cwd: root });
assert.ok(def.content.includes('步骤一'));
assert.ok(!def.content.includes('---'));

console.log('PASS: 子仓库 skill 发现 Provider 全部断言通过（' + names.length + ' 个 catalog 条目）');

// 显式关闭 watcher 并退出：Linux 上 fs.watch 递归监听可用且可能拖住事件循环，
// 冒烟测试断言完成后直接退出，不依赖 unref 语义。
ac.abort();
process.exit(0);
