// Builds every released version (git tags vN listed in versions.json) into site/vN/,
// the current main branch into site/dev/, and an index page at site/index.html. Every built
// version gets the version switcher (scripts/site/switcher.js), which reads site/versions.json.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const site = join(root, 'site');
const work = join(root, '.site-work');
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

rmSync(site, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });
mkdirSync(site, { recursive: true });

const data = JSON.parse(readFileSync(join(root, 'versions.json'), 'utf8'));
const versions = data.versions;

/** Adds the switcher script to a built version's index.html. */
const injectSwitcher = (dir) => {
  const file = join(dir, 'index.html');
  const html = readFileSync(file, 'utf8');
  writeFileSync(file, html.replace('</body>', '  <script src="../switcher.js" defer></script>\n  </body>'));
};
const tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const built = [];

for (const v of versions) {
  if (!tags.includes(v.tag)) {
    console.warn(`Skipping ${v.tag}: tag not found`);
    continue;
  }
  const dir = join(work, v.tag);
  run('git', ['worktree', 'add', '--detach', dir, v.tag]);
  try {
    run('npm', ['ci'], dir);
    run('npx', ['vite', 'build', '--base', './', '--outDir', join(site, v.tag), '--emptyOutDir'], dir);
    injectSwitcher(join(site, v.tag));
    built.push(v);
  } finally {
    run('git', ['worktree', 'remove', '--force', dir]);
  }
}

run('npx', ['vite', 'build', '--base', './', '--outDir', join(site, 'dev'), '--emptyOutDir']);
injectSwitcher(join(site, 'dev'));
copyFileSync(join(root, 'scripts', 'site', 'switcher.js'), join(site, 'switcher.js'));
// Only list versions that were actually built.
writeFileSync(join(site, 'versions.json'), JSON.stringify({ ...data, versions: built }, null, 2));

const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const changeList = (v) => `<ul class="changes">${(v.changes ?? []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`;
const items = built
  .slice()
  .reverse()
  .map(
    (v) =>
      `<li><a href="${v.tag}/"><strong>${v.tag}</strong> ${esc(v.title)}</a><p>${esc(v.summary)}</p><details><summary>Nytt i ${v.tag}</summary>${changeList(v)}</details></li>`,
  )
  .join('\n');

writeFileSync(
  join(site, 'index.html'),
  `<!doctype html>
<html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>popsim</title>
<style>
body { margin: 0; background: #0e1014; color: #d8dde4; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 32px 16px; }
h1 { font-size: 22px; margin: 0 0 4px; }
.muted { color: #8a93a0; }
ul { list-style: none; padding: 0; }
li { border: 1px solid #2a313b; border-radius: 8px; padding: 12px 14px; margin: 10px 0; background: #161a20; }
a { color: #8fd3e0; text-decoration: none; }
li p { margin: 4px 0 0; color: #8a93a0; }
details { margin-top: 6px; color: #8a93a0; }
summary { cursor: pointer; }
ul.changes { list-style: disc; padding-left: 20px; }
ul.changes li { border: 0; background: none; padding: 0; margin: 2px 0; }
</style></head>
<body><main>
<h1>popsim</h1>
<p class="muted">Agentbasert simulering av en bestand i et 2D-økosystem. Hver versjon er frosset og kan fortsatt kjøres.</p>
<ul>
${items}
<li><a href="dev/"><strong>dev</strong> ${esc(data.dev.title)}</a><p>${esc(data.dev.summary)}</p><details><summary>Endret siden siste versjon</summary>${changeList(data.dev)}</details></li>
</ul>
</main></body></html>
`,
);
rmSync(work, { recursive: true, force: true });
console.log(`Built ${built.length} version(s) + dev into ${site}`);
