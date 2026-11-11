import './style.css';
import { DEFAULT_HISTORY_CONFIG, History } from '../history/history';
import { exportGzip, fromExport, importGzip } from '../history/serialize';
import type { Rules, TickStats, Tribe, World } from '../sim/types';
import { DEFAULT_TRIBES } from '../sim/tribes';
import { TribeTable } from './tribe-table';
import { cloneWorld, createWorld, DEFAULT_CONFIG, radiusOf } from '../sim/world';
import { NAME_SOURCE } from '../sim/names';
import { APP_NAME, VERSION } from '../version';
import { mortality, type Mortality } from '../sim/mortality';
import { Charts } from './charts';
import { COLOR_MODE_LABELS, type ColorMode } from './colors';
import { BranchEditor, RulesPanel } from './editor';
import { Inspector, kinMap } from './inspector';
import { Renderer } from './renderer';
import { Timeline } from './timeline';

/** Oldest export version this build can read (v2 added tribes, health and conflict). */
const MIN_IMPORT_VERSION = 2;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------------------------
// State

let history = new History(DEFAULT_HISTORY_CONFIG);
let branchId = history.createRoot(createWorld()).id;
let tick = 0;
let playing = false;
/** Slider 0–100 maps logarithmically to 1–2000 ticks per second. */
const MAX_TPS = 2000;
const sliderToTps = (v: number) => Math.round(10 ** ((v / 100) * Math.log10(MAX_TPS)));
let ticksPerSecond = sliderToTps(30);
let tickBudget = 0;
let lastFrame = 0;
let colorMode: ColorMode = 'tribe';
let selectedId: number | null = null;
let showFertility = false;
let brushPos: { x: number; y: number } | null = null;
let painting = false;
/** Bumped whenever something outside the per-frame loop changes; panels re-render on change. */
let revision = 0;

const renderer = new Renderer($<HTMLCanvasElement>('world'));
const charts = new Charts($('charts'));

/** Window for the "recent" mortality figures, in ticks. */
const RECENT_TICKS = 500;

const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)} %` : '–');
const ticks = (v: number) => (Number.isFinite(v) ? `${Math.round(v)} ticks` : '–');
const mortalityText = (m: Mortality) =>
  `<b>${m.deaths}</b> døde · alderdom <b>${pct(m.ageShare)}</b> · drept <b>${pct(m.killedShare)}</b> · snitt dødsalder <b>${ticks(m.meanAge)}</b>`;

/** Mortality figures up to the displayed tick: whole lineage and the last RECENT_TICKS ticks. */
const renderVitals = (rows: TickStats[], at: number) => {
  const all = mortality(rows, -1, at);
  const recent = mortality(rows, at - RECENT_TICKS, at);
  $('vitals').innerHTML =
    `<span title="Fra tick 0 til tick som vises, langs denne grenens historikk. Fjerning i grenredigering telles ikke.">Hittil: ${mortalityText(all)}</span>` +
    `<span title="De siste ${RECENT_TICKS} ticks før tick som vises.">Siste ${RECENT_TICKS} ticks: ${mortalityText(recent)}</span>`;
};
const timeline = new Timeline($('timeline'));
const inspector = new Inspector($('inspector'), (id) => select(id));
const editor = new BranchEditor($('editor'), {
  commit: (name) => commitBranch(name),
  cancel: () => {
    editor.stop();
    showTab('inspector');
    $('tab-editor').hidden = true;
    touch();
  },
  changed: () => touch(),
});
const rules = new RulesPanel($('rules'), (apply, description) => changeRule(apply, description));

/** The world currently displayed: the edit draft, or the stored state at the cursor. */
const shownWorld = (): World => editor.draft ?? history.stateAt(branchId, tick);

const touch = () => revision++;

// ---------------------------------------------------------------------------------------------
// Actions

const select = (id: number | null) => {
  selectedId = id;
  editor.setSelected(id);
  if (id !== null && !editor.active) showTab('inspector');
  touch();
};

const seek = (bid: number, t: number) => {
  if (editor.active) return;
  branchId = bid;
  history.trimRings(bid);
  tick = history.stateAt(bid, t).tick;
  touch();
};

const stepBack = () => {
  playing = false;
  const t = history.prevTick(branchId, tick);
  if (t !== undefined) seek(branchId, t);
};

const stepForward = () => {
  const b = history.get(branchId);
  if (tick < b.headTick) {
    const t = history.nextTick(branchId, tick);
    if (t !== undefined) tick = t;
  } else {
    history.advance(branchId);
    tick = b.headTick;
  }
  touch();
};

const startEditing = () => {
  playing = false;
  editor.start(cloneWorld(history.stateAt(branchId, tick)));
  editor.setSelected(selectedId);
  $('tab-editor').hidden = false;
  showTab('editor');
  touch();
};

const commitBranch = (name: string) => {
  const draft = editor.draft!;
  const b = history.fork(branchId, draft.tick, draft, editor.allChanges(), name || undefined);
  editor.stop();
  $('tab-editor').hidden = true;
  showTab('inspector');
  branchId = b.id;
  history.trimRings(b.id);
  tick = b.startTick;
  touch();
};

const changeRule = (apply: (r: Rules) => void, description: string) => {
  if (editor.draft) {
    apply(editor.draft.rules);
    editor.log(description);
    return;
  }
  // Outside the editor a rule change forks a new branch from the displayed tick.
  const draft = cloneWorld(history.stateAt(branchId, tick));
  apply(draft.rules);
  const b = history.fork(branchId, draft.tick, draft, [description]);
  branchId = b.id;
  history.trimRings(b.id);
  tick = b.startTick;
  touch();
};

const newRun = (tribes: Tribe[]) => {
  editor.stop();
  $('tab-editor').hidden = true;
  history = new History(DEFAULT_HISTORY_CONFIG);
  branchId = history.createRoot(createWorld({ ...DEFAULT_CONFIG, tribes })).id;
  tick = 0;
  selectedId = null;
  playing = false;
  touch();
};

const doExport = async () => {
  playing = false;
  const blob = await exportGzip(history, branchId);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${APP_NAME}-v${VERSION}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json.gz`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

const doImport = async (file: File) => {
  try {
    const data = await importGzip(file);
    if (data.version < MIN_IMPORT_VERSION) {
      alert(`Filen er laget med v${data.version}. Aktørene i v${VERSION} har stammer, helse og kamp, som filen mangler. Åpne filen i v${data.version} (versjonsvelgeren nederst til venstre på nettsiden).`);
      return;
    }
    if (data.version !== VERSION && !confirm(`Filen er laget med v${data.version}, dette er v${VERSION}. Reglene kan oppføre seg annerledes. Importere likevel?`)) return;
    const res = fromExport(data);
    editor.stop();
    $('tab-editor').hidden = true;
    history = res.history;
    branchId = res.activeBranchId;
    tick = history.get(branchId).headTick;
    selectedId = null;
    playing = false;
    touch();
  } catch (err) {
    alert(`Kunne ikke importere: ${(err as Error).message}`);
  }
};

// ---------------------------------------------------------------------------------------------
// UI wiring

const showTab = (name: string) => {
  for (const b of document.querySelectorAll<HTMLElement>('.tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const t of document.querySelectorAll<HTMLElement>('.tab')) t.hidden = t.id !== name;
};

document.querySelector('.tabs')!.addEventListener('click', (e) => {
  const tab = (e.target as HTMLElement).dataset.tab;
  if (tab) showTab(tab);
});

$('version').textContent = `v${VERSION}`;
$('footer').innerHTML =
  `Navn fra <a href="${NAME_SOURCE.firstNames.url}">${NAME_SOURCE.publisher}, tabell ${NAME_SOURCE.firstNames.table}</a> ` +
  `og <a href="${NAME_SOURCE.surnames.url}">${NAME_SOURCE.surnames.table}</a> (${NAME_SOURCE.firstNames.year}), ${NAME_SOURCE.license}.`;
$('btn-play').onclick = () => {
  if (editor.active) return;
  playing = !playing;
  touch();
};
$('btn-back').onclick = stepBack;
$('btn-fwd').onclick = () => {
  if (editor.active) return;
  playing = false;
  stepForward();
};
$('btn-start').onclick = () => seek(branchId, history.get(branchId).startTick);
$('btn-end').onclick = () => seek(branchId, history.get(branchId).headTick);
$('btn-branch').onclick = () => !editor.active && startEditing();
const speedInput = $<HTMLInputElement>('speed');
const updateSpeed = () => {
  ticksPerSecond = sliderToTps(Number(speedInput.value));
  $('speed-label').textContent = `${ticksPerSecond} ticks/s`;
};
speedInput.oninput = updateSpeed;
updateSpeed();
$<HTMLInputElement>('show-fertility').onchange = (e) => {
  showFertility = (e.target as HTMLInputElement).checked;
};

const colorSelect = $<HTMLSelectElement>('color-mode');
colorSelect.innerHTML = Object.entries(COLOR_MODE_LABELS)
  .map(([v, l]) => `<option value="${v}">${l}</option>`)
  .join('');
colorSelect.onchange = () => (colorMode = colorSelect.value as ColorMode);

const tribeTable = new TribeTable($('tribe-table'), DEFAULT_TRIBES);
$('tribe-add').onclick = () => tribeTable.add();
$('tribe-reset').onclick = () => tribeTable.set(DEFAULT_TRIBES);
$('btn-new').onclick = () => {
  playing = false;
  tribeTable.set(history.get(branchId).head.tribes);
  $<HTMLDialogElement>('new-dialog').showModal();
};
$<HTMLDialogElement>('new-dialog').addEventListener('close', () => {
  const d = $<HTMLDialogElement>('new-dialog');
  if (d.returnValue !== 'ok') return;
  const tribes = tribeTable.read();
  if (tribes.reduce((n, t) => n + t.seeds, 0) < 2) {
    alert('Det trengs minst 2 seeds til sammen.');
    return;
  }
  newRun(tribes);
});
$('btn-export').onclick = () => void doExport();
$('btn-import').onclick = () => $('import-file').click();
$<HTMLInputElement>('import-file').onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void doImport(f);
  (e.target as HTMLInputElement).value = '';
};

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  if (e.key === ' ') {
    e.preventDefault();
    $('btn-play').click();
  } else if (e.key === 'ArrowLeft') stepBack();
  else if (e.key === 'ArrowRight') $('btn-fwd').click();
});

// Canvas: click selects an actor, drag pans, wheel zooms, double-click resets the view.
// While editing with the brush on, dragging paints instead.
const canvas = renderer.canvas;
const cssPoint = (e: { clientX: number; clientY: number }) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
const worldPoint = (e: PointerEvent) => {
  const p = cssPoint(e);
  return renderer.toWorld(p.x, p.y);
};
const selectAt = (p: { x: number; y: number }) => {
  const w = shownWorld();
  let best: number | null = null;
  let bestD = Infinity;
  for (const a of w.actors) {
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < radiusOf(a) + 6 / renderer.zoom + 2 && d < bestD) {
      best = a.id;
      bestD = d;
    }
  }
  select(best);
};
/** Pointer drag state: start point and whether it has moved far enough to count as a pan. */
let drag: { x: number; y: number; lastX: number; lastY: number; moved: boolean } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (editor.active && editor.brushOn) {
    painting = true;
    const p = worldPoint(e);
    editor.paint(p.x, p.y);
    return;
  }
  drag = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  brushPos = editor.active && editor.brushOn ? worldPoint(e) : null;
  if (painting && brushPos) editor.paint(brushPos.x, brushPos.y);
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
    if (drag.moved) {
      renderer.panBy(e.clientX - drag.lastX, e.clientY - drag.lastY);
      canvas.classList.add('panning');
    }
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  }
});
const endPointer = (e: PointerEvent) => {
  if (painting) editor.endStroke();
  painting = false;
  if (drag && !drag.moved && e.type === 'pointerup') selectAt(worldPoint(e));
  drag = null;
  canvas.classList.remove('panning');
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => (brushPos = null));
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const p = cssPoint(e);
    renderer.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false },
);
canvas.addEventListener('dblclick', () => renderer.resetView());

new ResizeObserver(() => {
  renderer.resize();
  touch();
}).observe(canvas);

// ---------------------------------------------------------------------------------------------
// Main loop

let lastPanels = 0;
let panelRevision = -1;
let kinKey = '';
let kin = new Map<number, number>();

const frame = (now: number) => {
  const dt = Math.min(100, now - (lastFrame || now));
  lastFrame = now;
  if (playing && !editor.active) {
    tickBudget += (ticksPerSecond * dt) / 1000;
    const n = Math.min(200, Math.floor(tickBudget));
    tickBudget -= n;
    for (let i = 0; i < n; i++) stepForward();
    const b = history.get(branchId);
    if (b.head.actors.length === 0 && tick === b.headTick) playing = false;
  }

  const w = shownWorld();
  const reg = history.get(branchId).registry;

  const key = `${branchId}:${w.tick}:${selectedId}:${editor.active}`;
  if (key !== kinKey) {
    kinKey = key;
    kin = selectedId === null ? new Map() : kinMap(w, reg, selectedId);
  }
  renderer.render(w, {
    colorMode,
    selectedId,
    kin,
    showFertility: showFertility || (editor.active && editor.brushOn && editor.brushMode.endsWith('Fertile')),
    brush: brushPos ? { ...brushPos, r: editor.brushRadius } : null,
  });

  // Panels are heavier; update them at most ~5 times per second, or on discrete changes.
  if (panelRevision !== revision || (playing && now - lastPanels > 200)) {
    lastPanels = now;
    panelRevision = revision;
    const b = history.get(branchId);
    $('btn-play').textContent = playing ? '⏸' : '▶';
    const exact = history.has(branchId, w.tick) ? '' : ' (nærmeste snapshot)';
    $('status').textContent = `Tick ${w.tick}${exact} / ${b.headTick} · ${b.name} · ${w.actors.length ? `${w.actors.length} aktører` : 'bestanden er utdødd'}`;
    rules.show(w.rules);
    inspector.render(w, reg, selectedId);
    timeline.render(history, branchId, w.tick, (bid, t) => {
      playing = false;
      seek(bid, t);
    });
    const statsRows = history.statsPath(branchId);
    renderVitals(statsRows, w.tick);
    charts.render(statsRows, w.tick, w.tribes, (t) => {
      // Seek within the lineage: pick the branch on the path that covers t.
      playing = false;
      const path = history.lineage(branchId);
      const target = path.find((_, i) => {
        const next = path[i + 1];
        return next === undefined || t <= history.get(next).startTick;
      })!;
      seek(target, t);
    });
  }
  requestAnimationFrame(frame);
};

renderer.resize();
requestAnimationFrame(frame);

// Development hook for browser tests; stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__popsim = { shownWorld, renderer, select };
}
