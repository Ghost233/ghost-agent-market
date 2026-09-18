import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const name = 'ghost-matt-skills';
export const inject = ['skills'];
const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));
const candidates = catalog.skills.map(({ name, description, invocation }) => ({
  name, description, invocation,
  provider: 'ghost-matt-skills', source: 'bundled', rank: 600,
  resourceBase: { kind: 'directory', path: fileURLToPath(new URL(`./skills/${name}/`, import.meta.url)) },
  locator: new URL(`./skills/${name}/SKILL.md`, import.meta.url),
}));

export function apply(ctx) {
  ctx.skills.registerProvider(() => ({
    name: 'ghost-matt-skills',
    async list() { return candidates; },
    async get(candidate) {
      const markdown = await readFile(candidate.locator, 'utf8');
      const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(markdown);
      if (!match) throw new Error(`Invalid skill frontmatter: ${candidate.name}`);
      return { ...candidate, content: markdown.slice(match[0].length) };
    },
  }));
}
