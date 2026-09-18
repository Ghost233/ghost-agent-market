// Deterministic DSH adaptation; canonical skill content stays in codex-market.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dsh-market/ghost-matt-skills');
const matt = join(root, 'codex-market/plugins/mattpocock-skills-zh/skills');
const ghost = join(root, 'codex-market/plugins/ghost-agent-skills/skills');
const names = readdirSync(matt).filter(n => existsSync(join(matt, n, 'SKILL.md'))).sort();
const custom = readdirSync(ghost).filter(n => n.startsWith('ghost-matt-')).sort();
if (names.length !== 26 || custom.length !== 5) throw Error('Skill inventory changed; review the 26 + 5 scope.');
const all = [...names, ...custom];
if (new Set(all).size !== 31) throw Error('Duplicate skill names.');
const platform = '> **DSH 平台适配：** 保留仓库中文原版流程；技能名表示当前 DSH 技能目录中的同名项，用户通过界面的技能选择器显式调用，模型仅在该项允许模型调用时使用 `skill({ name })`。手动调用策略保持不变。子代理使用当前 DSH 实际提供的委派工具及其参数，继承宿主已配置的模型；不要求 Codex/Claude 工具或硬编码模型，不自动更换 provider。若必须的委派能力不可用，说明具体限制，不伪造执行。\n';
const codexDelegate = '使用子代理时，调用 `collaboration.spawn_agent`，指定 `agent_type: "worker"`、`model: "gpt-5.6-terra"`、`reasoning_effort: "xhigh"`、`fork_turns: "none"`；宿主无法提供这些参数时说明限制，不静默换模型或声称已经委派。';
const dshDelegate = '使用子代理时，选择当前 DSH 实际提供的 spawn 型委派工具，传最小任务上下文且不复制父会话历史；继承宿主配置的模型与推理设置。必要能力不可用时说明限制，不静默换 provider 或声称已经委派。';

function adapt(text) {
  text = text.replace(/^> \*\*Codex 平台说明：\*\*.*\n/gm, '')
    .replace(/^平台差异：按用户要求，本版先在 Codex.*\n/gm, '')
    .replaceAll(codexDelegate, dshDelegate);
  for (const name of all) text = text.replaceAll('$' + name, name);
  return text;
}

// The maintained sources use single-line name/description fields. Fail rather
// than silently misreading a future multiline YAML shape.
function field(text, key) {
  const value = new RegExp(`^${key}: (.+)$`, 'm').exec(text)?.[1];
  if (!value || /^[>|']/.test(value)) throw Error(`Unsupported ${key} frontmatter`);
  return value.startsWith('"') ? JSON.parse(value) : value;
}

const files = [];
function copyTree(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'agents') continue; // Codex UI metadata is converted below.
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isSymbolicLink()) throw Error(`Unexpected symlink: ${from}`);
    if (entry.isDirectory()) { copyTree(from, to); continue; }
    if (!entry.isFile()) throw Error(`Unexpected resource: ${from}`);
    const raw = readFileSync(from);
    files.push({ source: relative(root, from), target: relative(out, to), sha256: createHash('sha256').update(raw).digest('hex') });
    if (entry.name.endsWith('.md')) writeFileSync(to, adapt(raw.toString('utf8')), { mode: statSync(from).mode });
    else copyFileSync(from, to);
  }
}

const skills = [];
for (const name of all) {
  const source = join(name.startsWith('ghost-matt-') ? ghost : matt, name);
  const target = join(out, 'skills', name);
  const original = readFileSync(join(source, 'SKILL.md'), 'utf8');
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(original)?.[1];
  if (!frontmatter || field(frontmatter, 'name') !== name) throw Error(`Invalid identity: ${name}`);
  const policyPath = join(source, 'agents/openai.yaml');
  const policy = existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : '';
  const manual = /^\s*allow_implicit_invocation: false\s*$/m.test(policy) || /^disable-model-invocation: true$/m.test(frontmatter);
  copyTree(source, target);
  let body = adapt(original).replace(/^---\n([\s\S]*?)\n---\n/, (_match, fields) =>
    `---\n${fields}${manual && !fields.includes('disable-model-invocation:') ? '\ndisable-model-invocation: true' : ''}\n---\n\n${platform}`);
  if (body.includes('collaboration.spawn_agent')) throw Error(`Unadapted delegation: ${name}`);
  writeFileSync(join(target, 'SKILL.md'), body);
  skills.push({ name, description: field(frontmatter, 'description'), invocation: { modelInvocable: !manual, userInvocable: true }, group: name.startsWith('ghost-matt-') ? 'ghost-matt' : 'mattpocock-skills-zh' });
}
copyFileSync(join(root, 'codex-market/plugins/mattpocock-skills-zh/LICENSE'), join(out, 'LICENSE'));
writeFileSync(join(out, 'catalog.json'), JSON.stringify({ skills, files }, null, 2) + '\n');
console.log(`Built ${skills.length} DSH skills and ${files.length - skills.length} resources in ${out}`);
