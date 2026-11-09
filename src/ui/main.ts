import './style.css';
import { DEFAULT_HISTORY_CONFIG, History } from '../history/history';
import { exportGzip, fromExport, importGzip } from '../history/serialize';
import type { Rules, World } from '../sim/types';
import { cloneWorld, createWorld, DEFAULT_CONFIG, radiusOf } from '../sim/world';
import { NAME_SOURCE } from '../sim/names';
import { APP_NAME, VERSION } from '../version';
import { Charts } from './charts';
import { COLOR_MODE_LABELS, type ColorMode } from './colors';
import { BranchEditor, RulesPanel } from './editor';
import { Inspector, kinMap } from './inspector';
import { Renderer } from './renderer';
import { Timeline } from './timeline';

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
let colorMode: ColorMode = 'lineage';
let selectedId: number | null = null;
let showFertility = false;
let brushPos: { x: number; y: number } | null = null;
let painting = false;
/** Bumped whenever something outside the per-frame loop changes; panels re-render on change. */
let revision = 0;

const renderer = new Renderer($<HTMLCanvasElement>('world'));
const charts = new Charts($('charts'));
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

const newRun = (seeds: number) => {
  editor.stop();
  $('tab-editor').hidden = true;
  history = new History(DEFAULT_HISTORY_CONFIG);
  branchId = history.createRoot(createWorld({ ...DEFAULT_CONFIG, seeds })).id;
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

$('btn-new').onclick = () => {
  playing = false;
  $<HTMLDialogElement>('new-dialog').showModal();
};
$<HTMLDialogElement>('new-dialog').addEventListener('close', () => {
  const d = $<HTMLDialogElement>('new-dialog');
  if (d.returnValue === 'ok') newRun(Math.max(2, Math.min(500, Number($<HTMLInputElement>('seed-count').value) || 20)));
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

// Canvas: select actors, or paint with the environment brush while editing.
const canvas = renderer.canvas;
const worldPoint = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return renderer.toWorld(e.clientX - r.left, e.clientY - r.top);
};
canvas.addEventListener('pointerdown', (e) => {
  const p = worldPoint(e);
  if (editor.active && editor.brushOn) {
    painting = true;
    canvas.setPointerCapture(e.pointerId);
    editor.paint(p.x, p.y);
    return;
  }
  const w = shownWorld();
  let best: number | null = null;
  let bestD = Infinity;
  for (const a of w.actors) {
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < radiusOf(a) + 6 && d < bestD) {
      best = a.id;
      bestD = d;
    }
  }
  select(best);
});
canvas.addEventListener('pointermove', (e) => {
  brushPos = editor.active && editor.brushOn ? worldPoint(e) : null;
  if (painting && brushPos) editor.paint(brushPos.x, brushPos.y);
});
const endPaint = () => {
  if (painting) editor.endStroke();
  painting = false;
};
canvas.addEventListener('pointerup', endPaint);
canvas.addEventListener('pointercancel', endPaint);
canvas.addEventListener('pointerleave', () => (brushPos = null));

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
    charts.render(history.statsPath(branchId), w.tick, (t) => {
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
