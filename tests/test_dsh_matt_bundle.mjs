// Usage: node tests/test_dsh_matt_bundle.mjs <DSH npm prefix> [installed bundle directory]
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prefix = process.argv[2];
assert(prefix, 'Pass a prefix containing the official DSH runtime.');
const bundlePath = realpathSync(process.argv[3] || join(root, 'dsh-market/ghost-matt-skills'));
const requireRuntime = createRequire(join(resolve(prefix), 'package.json'));
const { Context } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/cordis')));
const { default: SkillRegistry, renderSkillContent, isModelInvocable, isUserInvocable } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-skill')));
const bundle = await import(pathToFileURL(join(bundlePath, 'index.mjs')));
const catalog = JSON.parse(readFileSync(join(bundlePath, 'catalog.json'), 'utf8'));
assert.equal(catalog.skills.length, 31);
assert.equal(catalog.skills.filter(s => s.group === 'mattpocock-skills-zh').length, 26);
assert.equal(catalog.skills.filter(s => s.group === 'ghost-matt').length, 5);
assert.deepEqual(readdirSync(join(bundlePath, 'skills')).sort(), catalog.skills.map(s => s.name).sort());
for (const file of catalog.files) {
  assert(existsSync(join(bundlePath, file.target)), file.target);
  assert.equal(createHash('sha256').update(readFileSync(join(root, file.source))).digest('hex'), file.sha256, 'Source changed; rebuild: ' + file.source);
  if (!file.source.endsWith('.md')) assert.deepEqual(readFileSync(join(bundlePath, file.target)), readFileSync(join(root, file.source)));
}
const ctx = new Context();
const registry = await ctx.plugin(SkillRegistry);
const mounted = await ctx.plugin(bundle);
try {
  const snapshot = await ctx.skills.snapshot();
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.skills.length, 31);
  for (const expected of catalog.skills) {
    const skill = await ctx.skills.get(expected.name);
    assert(skill, expected.name);
    assert.equal(isModelInvocable(skill), expected.invocation.modelInvocable);
    assert.equal(isUserInvocable(skill), true);
    assert.equal(skill.resourceBase.path, join(bundlePath, 'skills', expected.name) + '/');
    assert(!skill.content.includes('collaboration.spawn_agent'));
    assert(renderSkillContent(skill).includes(expected.name));
    const prose = skill.content.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
    for (const match of prose.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (!match[1].includes('://')) assert(existsSync(resolve(skill.resourceBase.path, match[1])), expected.name + ': ' + match[1]);
    }
  }
  assert.equal((await ctx.skills.get('ghost-matt-implement')).invocation.modelInvocable, false);
  assert.equal((await ctx.skills.get('tdd')).invocation.modelInvocable, true);
  await mounted.dispose();
  assert.equal((await ctx.skills.list()).length, 0, 'Unload must remove all contributions.');
  const reloaded = await ctx.plugin(bundle);
  assert.equal((await ctx.skills.list()).length, 31, 'Reload must not duplicate contributions.');
  await reloaded.dispose();
  console.log('PASS: 31 skills, source fingerprints, resources, invocation policy, real DSH registry load/unload/reload.');
} finally {
  await mounted.dispose();
  await registry.dispose();
}
