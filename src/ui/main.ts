import './style.css';
import { DEFAULT_HISTORY_CONFIG, History } from '../history/history';
import { exportGzip, fromExport, importGzip } from '../history/serialize';
import type { EleKey, Rules, TickStats, Tribe, World } from '../sim/types';
import { DEFAULT_TRIBES } from '../sim/tribes';
import { TribeTable } from './tribe-table';
import { cloneWorld, createWorld, DEFAULT_CONFIG, radiusOf } from '../sim/world';
import { NAME_SOURCE } from '../sim/names';
import { APP_NAME, IS_DEV, VERSION, VERSION_LABEL } from '../version';
import { mortality, type Mortality } from '../sim/mortality';
import { Charts } from './charts';
import { COLOR_MODE_LABELS, type ColorMode } from './colors';
import { BranchEditor, RulesPanel } from './editor';
import { ancestryBreakdown, Inspector, kinMap } from './inspector';
import { Leaderboards } from './leaderboards';
import { createEle, ELE_DEFS } from '../sim/ele';
import { Renderer } from './renderer';
import { Timeline } from './timeline';

/** Oldest export version this build can read (v3 adds pregnancy, ageing and disease to actors). */
const MIN_IMPORT_VERSION = 3;

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
let showCourtship = true;
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
const renderVitals = (rows: TickStats[], at: number, w: World) => {
  const all = mortality(rows, -1, at);
  const recent = mortality(rows, at - RECENT_TICKS, at);
  $('vitals').innerHTML =
    `<span class="anc-overall" title="Gjennomsnittlig avstamning blant de levende på tick som vises">Avstamning: ${ancestryBreakdown(w, 16)}</span>` +
    `<span title="Fra tick 0 til tick som vises, langs denne grenens historikk. Fjerning i grenredigering telles ikke.">Hittil: ${mortalityText(all)}</span>` +
    `<span title="De siste ${RECENT_TICKS} ticks før tick som vises.">Siste ${RECENT_TICKS} ticks: ${mortalityText(recent)}</span>`;
};
const timeline = new Timeline($('timeline'));
const inspector = new Inspector($('inspector'), {
  select: (id) => navigateTo(id),
  back: () => goBack(),
  goToLife: (id) => goToLife(id),
});
const leaderboards = new Leaderboards($('leaderboards'), (id) => navigateTo(id));
let lastBoards = 0;
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
const rules = new RulesPanel(
  $('rules'),
  (apply, description) => changeRule(apply, description),
  (key) => requestEle(key),
);

/** The world currently displayed: the edit draft, or the stored state at the cursor. */
const shownWorld = (): World => editor.draft ?? history.stateAt(branchId, tick);

const touch = () => revision++;

// ---------------------------------------------------------------------------------------------
// Actions

/** Previously shown actors, for the inspector's back button. */
const navStack: number[] = [];

/**
 * Selects an actor. `push` remembers the current one for "Tilbake"; `center` moves the view to
 * the actor if it is alive at the displayed tick.
 */
const select = (id: number | null, opts: { push?: boolean; center?: boolean } = {}) => {
  if (opts.push && selectedId !== null && id !== selectedId) {
    navStack.push(selectedId);
    if (navStack.length > 100) navStack.shift();
  }
  selectedId = id;
  editor.setSelected(id);
  if (id !== null && !editor.active) showTab('inspector');
  if (opts.center && id !== null) {
    const a = shownWorld().actors.find((x) => x.id === id);
    if (a) renderer.centerOn(a.x, a.y);
  }
  touch();
};

/** Navigates to an actor from a link: remember where we came from and centre on it. */
const navigateTo = (id: number) => select(id, { push: true, center: true });

const goBack = () => {
  const prev = navStack.pop();
  if (prev !== undefined) select(prev, { center: true });
};

/** Seeks to tick t on the branch of the current lineage that covers it. */
const seekLineage = (t: number) => {
  const path = history.lineage(branchId);
  const target = path.find((_, i) => {
    const next = path[i + 1];
    return next === undefined || t <= history.get(next).startTick;
  })!;
  seek(target, t);
};

/**
 * Pauses and seeks to a stored tick where the actor is alive: just before its death, or else the
 * first snapshot after its birth.
 */
const goToLife = (id: number) => {
  if (editor.active) return;
  playing = false;
  const reg = history.get(branchId).registry;
  const rec = reg.get(id);
  if (!rec) return;
  const death = reg.death(id);
  const end = death ? death.tick - 1 : history.get(branchId).headTick;
  const interval = history.config.snapshotInterval;
  const candidates = [end, Math.ceil(rec.born / interval) * interval, rec.born];
  for (const t of candidates) {
    if (t < rec.born || t > end) continue;
    seekLineage(t);
    if (shownWorld().actors.some((a) => a.id === id)) break;
  }
  select(id, { center: true });
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
  // At the head of a branch, change the rules in place unless the user wants a branch per change.
  // Earlier ticks always fork: changing them in place would invalidate the ticks after them.
  const b0 = history.get(branchId);
  if (!rules.branchOnChange && tick === b0.headTick) {
    history.amendRules(branchId, apply, description);
    touch();
    return;
  }
  const draft = cloneWorld(history.stateAt(branchId, tick));
  apply(draft.rules);
  const b = history.fork(branchId, draft.tick, draft, [description]);
  branchId = b.id;
  history.trimRings(b.id);
  tick = b.startTick;
  touch();
};

/** Meteor waiting for the user to click its impact point on the map. */
let pendingMeteor = false;

/** Releases a catastrophe: a meteor first asks for an impact point. */
const requestEle = (key: EleKey) => {
  if (key === 'meteor') {
    pendingMeteor = true;
    renderer.canvas.classList.add('aiming');
    showBanner('☄ Klikk i verden for å velge nedslagssted (Esc avbryter)', 0);
    return;
  }
  triggerEle(key);
};

/**
 * Starts a catastrophe: in the branch draft while editing, in place at the head of the branch, or
 * as a new branch from an earlier tick (like rule changes).
 */
const triggerEle = (key: EleKey, at?: { x: number; y: number }) => {
  const label = `Katastrofe: ${ELE_DEFS[key].name}${at ? ` ved (${Math.round(at.x)}, ${Math.round(at.y)})` : ''}`;
  if (editor.draft) {
    createEle(editor.draft, key, true, at);
    editor.log(label);
    touch();
    return;
  }
  const b0 = history.get(branchId);
  if (!rules.branchOnChange && tick === b0.headTick) {
    history.amendHead(branchId, (w) => createEle(w, key, true, at));
    touch();
    return;
  }
  const draft = cloneWorld(history.stateAt(branchId, tick));
  createEle(draft, key, true, at);
  const b = history.fork(branchId, draft.tick, draft, [label]);
  branchId = b.id;
  history.trimRings(b.id);
  tick = b.startTick;
  touch();
};

let bannerTimer = 0;
/** Shows a banner over the world; `ms` 0 keeps it until replaced or hidden. */
const showBanner = (text: string, ms = 4000) => {
  const el = $('banner');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(bannerTimer);
  if (ms > 0) bannerTimer = window.setTimeout(() => (el.hidden = true), ms);
};

/** Last event id announced, so each catastrophe gets one banner when it starts on screen. */
let announced = -1;
const announceEvents = (w: World) => {
  const evs = w.events ?? [];
  const fresh = evs.filter((e) => e.applied && e.id > announced && w.tick - e.tick < 50);
  if (fresh.length) {
    const e = fresh[fresh.length - 1];
    showBanner(`${ELE_DEFS[e.key].icon} ${e.name} ved tick ${e.tick}${e.manual ? '' : ' (tilfeldig)'}`);
  }
  announced = Math.max(announced, ...evs.filter((e) => e.applied).map((e) => e.id), -1);
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
  a.download = `${APP_NAME}-${VERSION_LABEL}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json.gz`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

const doImport = async (file: File) => {
  try {
    const data = await importGzip(file);
    if (data.version < MIN_IMPORT_VERSION) {
      alert(`Filen er laget med v${data.version}. Aktørene i ${VERSION_LABEL} har felt (som svangerskap, aldring og sykdom) som filen mangler. Åpne filen i v${data.version} (versjonsvelgeren nederst til venstre på nettsiden).`);
      return;
    }
    if (data.version !== VERSION && !confirm(`Filen er laget med v${data.version}, dette er ${VERSION_LABEL}. Reglene kan oppføre seg annerledes. Importere likevel?`)) return;
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
  if (name === 'leaderboards') leaderboards.dirty = true;
  touch();
  for (const b of document.querySelectorAll<HTMLElement>('.tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const t of document.querySelectorAll<HTMLElement>('.tab')) t.hidden = t.id !== name;
};

document.querySelector('.tabs')!.addEventListener('click', (e) => {
  const tab = (e.target as HTMLElement).dataset.tab;
  if (tab) showTab(tab);
});

$('version').textContent = VERSION_LABEL;
if (IS_DEV) $('version').title = `Utviklingsversjon bygget fra main. Blir v${VERSION} når den fryses.`;
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
$<HTMLInputElement>('show-courtship').onchange = (e) => {
  showCourtship = (e.target as HTMLInputElement).checked;
};
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
  if (e.key === 'Escape' && pendingMeteor) {
    pendingMeteor = false;
    renderer.canvas.classList.remove('aiming');
    $('banner').hidden = true;
  } else if (e.key === ' ') {
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
  select(best, { push: best !== null });
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
  if (drag && !drag.moved && e.type === 'pointerup') {
    if (pendingMeteor) {
      pendingMeteor = false;
      canvas.classList.remove('aiming');
      $('banner').hidden = true;
      triggerEle('meteor', worldPoint(e));
    } else selectAt(worldPoint(e));
  }
  drag = null;
  canvas.classList.remove('panning');
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => (brushPos = null));
canvas.addEventListener(
  'wheel',
  (e) => {
    // Fully zoomed out and scrolling outward: let the page scroll instead of trapping the wheel.
    if (renderer.zoom <= 1 && e.deltaY > 0) return;
    e.preventDefault();
    const p = cssPoint(e);
    renderer.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false },
);
const zoomCenter = (factor: number) => {
  const r = canvas.getBoundingClientRect();
  renderer.zoomAt(r.width / 2, r.height / 2, factor);
};
$('zoom-in').onclick = () => zoomCenter(1.5);
$('zoom-out').onclick = () => zoomCenter(1 / 1.5);
$('zoom-reset').onclick = () => renderer.resetView();
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
  if (!editor.active) announceEvents(w);
  const zl = `${renderer.zoom < 10 ? renderer.zoom.toFixed(1).replace('.0', '') : Math.round(renderer.zoom)}×`;
  if ($('zoom-level').textContent !== zl) $('zoom-level').textContent = zl;
  renderer.render(w, {
    colorMode,
    selectedId,
    kin,
    showFertility: showFertility || (editor.active && editor.brushOn && editor.brushMode.endsWith('Fertile')),
    showCourtship,
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
    rules.show(w.rules, w.tribes);
    inspector.render(w, reg, selectedId, navStack.length > 0);
    // Leaderboards are heavier: only while their tab is open, at most once per second.
    if (!$('leaderboards').hidden && (leaderboards.dirty || !playing || now - lastBoards > 1000)) {
      lastBoards = now;
      leaderboards.render(w, reg, w.tick);
    }
    timeline.render(history, branchId, w.tick, (bid, t) => {
      playing = false;
      seek(bid, t);
    });
    const statsRows = history.statsPath(branchId);
    renderVitals(statsRows, w.tick, w);
    charts.render(statsRows, w.tick, w.tribes, (t) => {
      playing = false;
      seekLineage(t);
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
