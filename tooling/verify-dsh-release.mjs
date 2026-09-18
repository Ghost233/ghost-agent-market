// Validate and package in CI; never publish or touch a user's DSH profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const root = process.cwd();
const runtime = resolve('tests/dsh-runtime');
const pkg = JSON.parse(readFileSync('dsh-market/ghost-matt-skills/package.json'));
const tag = `dsh-ghost-matt-skills-v${pkg.version}`;
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
if (process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME, tag);
for (const name of ['dsh', 'dsh-skill']) {
  const manifest = JSON.parse(readFileSync(join(runtime, 'node_modules/@deepseek-ai', name, 'package.json')));
  assert.equal(manifest.version, '0.1.6-alpha.1', `${name} must match the fixed DSH release`);
}
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...options });
run(process.execPath, ['tooling/build-dsh-matt.mjs']);
run('git', ['diff', '--exit-code', '--', 'dsh-market/ghost-matt-skills/skills', 'dsh-market/ghost-matt-skills/catalog.json', 'dsh-market/ghost-matt-skills/LICENSE']);
run(process.execPath, ['tests/test_dsh_matt_bundle.mjs', runtime]);
const out = resolve(process.env.DSH_RELEASE_DIR || 'dist/dsh-release');
mkdirSync(out, { recursive: true });
const packed = JSON.parse(execFileSync('npm', ['pack', './dsh-market/ghost-matt-skills', '--pack-destination', out, '--json'], { encoding: 'utf8' }));
assert.equal(packed.length, 1);
assert.equal(packed[0].filename, `${pkg.name}-${pkg.version}.tgz`);
const archive = join(out, packed[0].filename);
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
assert.equal(entries.filter(p => p.endsWith('/SKILL.md')).length, 31);
for (const entry of entries) {
  assert(entry.startsWith('package/') && !entry.split('/').includes('..'));
  assert.deepEqual(execFileSync('tar', ['-xOzf', archive, entry]), readFileSync(join('dsh-market/ghost-matt-skills', entry.slice(8))));
}
const home = mkdtempSync(join(tmpdir(), 'dsh-release-check-'));
const cli = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
const env = { ...process.env, DSH_HOME: home, PATH: join(runtime, 'node_modules/.bin') + delimiter + process.env.PATH };
assert.equal(execFileSync('pnpm', ['--version'], { env, encoding: 'utf8' }).trim(), '11.24.0');
run(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', archive], { env });
const config = execFileSync(process.execPath, [cli, '--profile', 'web', '--dump-config'], { env, encoding: 'utf8' });
assert(config.includes('# == dsh-ghost-matt-skills'));
run(process.execPath, ['tests/test_dsh_matt_bundle.mjs', runtime, join(home, 'profiles/web/node_modules/dsh-ghost-matt-skills')]);
const bytes = readFileSync(archive);
const hash = createHash('sha256').update(bytes).digest('hex');
writeFileSync(join(out, 'SHA256SUMS'), `${hash}  ${packed[0].filename}\n`);
const repository = process.env.GITHUB_REPOSITORY || 'Ghost233/ghost-agent-market';
const url = `https://github.com/${repository}/releases/download/${tag}/${packed[0].filename}`;
writeFileSync(join(out, 'release-notes.md'), `# DSH Ghost Matt Skills ${pkg.version}\n\n26 个 Matt 中文技能 + 5 个 Ghost Matt 技能，含 27 个支持资源。由 GitHub Actions 构建并发布，不发布 npm。\n\n安装：\n\n\`\`\`sh\ndsh plugin --profile web add ${url}\n\`\`\`\n\n验证：Node 24、固定 npm DSH 0.1.6-alpha.1 及锁文件依赖；隔离安装、配置组合、31 项 SkillRegistry 加载/卸载/重载、调用策略、资源与包内容一致性均通过。未运行付费模型或全部技能业务流程；npm 发行包验证不等同于重建 DSH-Workflow 子模块。\n\nSHA-256: \`${hash}\`\n\n大小：${bytes.length} bytes\n`);
console.log(`PASS: ${tag}; ${bytes.length} bytes; sha256 ${hash}`);
