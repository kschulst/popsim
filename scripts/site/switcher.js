// Version switcher injected into every built version (site/vN/ and site/dev/) by build-site.mjs.
// It is site chrome, not part of a version's code, so frozen versions get it too. It reads
// ../versions.json, links to the other versions and lists the changes between any two versions.
(() => {
  const parts = location.pathname.split('/');
  const i = parts.findIndex((p) => /^v\d+$/.test(p) || p === 'dev');
  if (i < 0) return;
  const current = parts[i];
  const base = parts.slice(0, i).join('/') + '/';

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

  const css = `
.vs-btn { position: fixed; left: 12px; bottom: 12px; z-index: 1000; font: 12px/1 ui-sans-serif, system-ui, sans-serif;
  background: #1c2129; color: #d8dde4; border: 1px solid #3a4250; border-radius: 6px; padding: 7px 10px; cursor: pointer; }
.vs-btn:hover { border-color: #8fd3e0; }
.vs-panel { position: fixed; left: 12px; bottom: 48px; z-index: 1000; width: min(460px, calc(100vw - 24px));
  max-height: calc(100vh - 72px); overflow: auto; background: #161a20; color: #d8dde4; border: 1px solid #3a4250;
  border-radius: 8px; padding: 12px 14px; font: 13px/1.45 ui-sans-serif, system-ui, sans-serif; box-shadow: 0 8px 24px #0008; }
.vs-panel h4 { margin: 10px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #8a93a0; }
.vs-panel h4:first-child { margin-top: 0; }
.vs-list { list-style: none; margin: 0; padding: 0; }
.vs-list li { margin: 2px 0; }
.vs-list a { color: #8fd3e0; text-decoration: none; }
.vs-list a:hover { text-decoration: underline; }
.vs-list .vs-cur { color: #f2c94c; }
.vs-muted { color: #8a93a0; }
.vs-cmp { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.vs-cmp select { background: #0e1014; color: #d8dde4; border: 1px solid #3a4250; border-radius: 4px; padding: 3px 4px; }
.vs-diff h5 { margin: 10px 0 2px; font-size: 13px; }
.vs-diff ul { margin: 2px 0 0; padding-left: 18px; }
`;

  const label = (e) => (e.tag === 'dev' ? 'dev' : e.tag);

  const init = (data) => {
    const entries = [...data.versions, { ...data.dev, tag: 'dev' }];
    const idx = Math.max(0, entries.findIndex((e) => e.tag === current));

    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);

    const btn = document.createElement('button');
    btn.className = 'vs-btn';
    btn.type = 'button';
    btn.textContent = `Versjon: ${current} ▴`;
    btn.title = 'Bytt versjon eller se forskjeller mellom versjoner';

    const panel = document.createElement('div');
    panel.className = 'vs-panel';
    panel.hidden = true;

    const options = (sel) =>
      entries.map((e, j) => `<option value="${j}"${j === sel ? ' selected' : ''}>${esc(label(e))}</option>`).join('');

    panel.innerHTML = `
<h4>Versjoner</h4>
<ul class="vs-list">
${entries
  .map(
    (e) =>
      `<li>${e.tag === current ? `<span class="vs-cur">● ${esc(label(e))}</span>` : `<a href="${base}${e.tag}/">${esc(label(e))}</a>`} <span class="vs-muted">${esc(e.title)}</span></li>`,
  )
  .join('')}
</ul>
<p class="vs-muted">Kjøringen følger ikke med når du bytter. Eksporter først hvis du vil ta vare på den.</p>
<h4>Forskjeller</h4>
<div class="vs-cmp">Fra <select data-k="from">${options(idx > 0 ? idx - 1 : 0)}</select> til <select data-k="to">${options(idx > 0 ? idx : Math.min(1, entries.length - 1))}</select></div>
<div class="vs-diff"></div>
<p><a class="vs-muted" href="${base}">Alle versjoner</a></p>`;

    const from = panel.querySelector('[data-k=from]');
    const to = panel.querySelector('[data-k=to]');
    const diff = panel.querySelector('.vs-diff');
    const renderDiff = () => {
      const a = Number(from.value);
      const b = Number(to.value);
      if (a === b) {
        diff.innerHTML = `<p class="vs-muted">Samme versjon. Innhold i ${esc(label(entries[a]))}:</p>` + section(entries[a]);
        return;
      }
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const head =
        a < b
          ? `Nytt i ${esc(label(entries[hi]))} sammenlignet med ${esc(label(entries[lo]))}:`
          : `${esc(label(entries[lo]))} mangler dette, som finnes i ${esc(label(entries[hi]))}:`;
      diff.innerHTML = `<p class="vs-muted">${head}</p>` + entries.slice(lo + 1, hi + 1).map(section).join('');
    };
    const section = (e) => {
      const items = e.changes?.length ? e.changes : [e.tag === 'dev' ? 'Ingen endringer siden siste versjon.' : e.summary];
      return `<h5>${esc(label(e))}: ${esc(e.title)}</h5><ul>${items.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`;
    };
    from.addEventListener('change', renderDiff);
    to.addEventListener('change', renderDiff);
    renderDiff();

    btn.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      btn.textContent = `Versjon: ${current} ${panel.hidden ? '▴' : '▾'}`;
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !panel.hidden) btn.click();
    });
    document.body.append(panel, btn);
  };

  fetch(`${base}versions.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(init)
    .catch((err) => console.warn('Versjonsvelger: kunne ikke laste versions.json', err));
})();
