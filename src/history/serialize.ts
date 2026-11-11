import { Registry, type Death, type LifeRecord } from '../sim/genealogy';
import type { TickStats, World } from '../sim/types';
import { APP_NAME, VERSION } from '../version';
import { History, type Branch, type HistoryConfig } from './history';

interface WorldJson extends Omit<World, 'food' | 'fertility'> {
  food: string;
}

interface BranchJson {
  id: number;
  name: string;
  parentId: number | null;
  startTick: number;
  changes: string[];
  ruleLog?: { tick: number; text: string }[];
  createdAt: number;
  headTick: number;
  /** Shared by every state in the branch. */
  fertility: string;
  head: WorldJson;
  snapshots: WorldJson[];
  stats: TickStats[];
  registry: {
    forkTick: number;
    forkNextId: number;
    records: LifeRecord[];
    deaths: [number, Death][];
  };
}

export interface ExportFile {
  format: string;
  version: number;
  exportedAt: string;
  config: HistoryConfig;
  activeBranchId: number;
  branches: BranchJson[];
}

const u8ToBase64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const base64ToU8 = (s: string): Uint8Array => {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const f32ToBase64 = (a: Float32Array): string => u8ToBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
const base64ToF32 = (s: string): Float32Array => new Float32Array(base64ToU8(s).buffer);

const encodeWorld = (w: World): WorldJson => {
  const { fertility: _omit, ...rest } = w;
  return { ...rest, food: u8ToBase64(w.food) };
};
const decodeWorld = (w: WorldJson, fertility: Float32Array): World => ({
  ...w,
  food: base64ToU8(w.food),
  fertility,
});

export const toExport = (h: History, activeBranchId: number): ExportFile => ({
  format: APP_NAME,
  version: VERSION,
  exportedAt: new Date().toISOString(),
  config: h.config,
  activeBranchId,
  branches: [...h.branches.values()].map((b) => ({
    id: b.id,
    name: b.name,
    parentId: b.parentId,
    startTick: b.startTick,
    changes: b.changes,
    ruleLog: b.ruleLog,
    createdAt: b.createdAt,
    headTick: b.headTick,
    fertility: f32ToBase64(b.head.fertility),
    head: encodeWorld(b.head),
    snapshots: [...b.snapshots.values()].map(encodeWorld),
    stats: b.stats,
    registry: {
      forkTick: b.registry.forkTick,
      forkNextId: b.registry.forkNextId,
      records: [...b.registry.records.values()],
      deaths: [...b.registry.deaths.entries()],
    },
  })),
});

/** Accepted `format` values; 'sim-sala-bim' is the app's former name. */
const EXPORT_FORMATS = [APP_NAME, 'sim-sala-bim'];

export const fromExport = (file: ExportFile): { history: History; activeBranchId: number } => {
  if (!EXPORT_FORMATS.includes(file.format)) throw new Error(`Filen er ikke en eksport fra ${APP_NAME}.`);
  const history = new History(file.config);
  // Parents must be restored before children so registries can link up.
  const sorted = [...file.branches].sort((a, b) => a.id - b.id);
  for (const bj of sorted) {
    const parentReg = bj.parentId === null ? null : history.get(bj.parentId).registry;
    const registry = new Registry(parentReg, bj.registry.forkTick, bj.registry.forkNextId);
    for (const r of bj.registry.records) {
      // Records with ids from before the fork are overrides of parent records (edited at the fork).
      if (parentReg && r.id < bj.registry.forkNextId) registry.override(r);
      else registry.add(r);
    }
    for (const [id, d] of bj.registry.deaths) registry.die(id, d);
    const fertility = base64ToF32(bj.fertility);
    const head = decodeWorld(bj.head, fertility);
    const branch: Branch = {
      id: bj.id,
      name: bj.name,
      parentId: bj.parentId,
      startTick: bj.startTick,
      changes: bj.changes,
      ruleLog: bj.ruleLog ?? [],
      createdAt: bj.createdAt,
      headTick: bj.headTick,
      head,
      snapshots: new Map(bj.snapshots.map((s) => [s.tick, decodeWorld(s, fertility)])),
      ring: [{ ...structuredClone({ ...head, fertility: undefined }), fertility }],
      registry,
      // Files from before age at death was recorded lack deathAgeSum.
      stats: bj.stats.map((st) => ({ ...st, deathAgeSum: st.deathAgeSum ?? NaN })),
    };
    history.restore(branch);
  }
  return { history, activeBranchId: file.activeBranchId };
};

const pipeText = async (data: BlobPart, stream: CompressionStream | DecompressionStream): Promise<Blob> =>
  new Response(new Blob([data]).stream().pipeThrough(stream)).blob();

export const exportGzip = async (h: History, activeBranchId: number): Promise<Blob> =>
  pipeText(JSON.stringify(toExport(h, activeBranchId)), new CompressionStream('gzip'));

export const importGzip = async (blob: Blob): Promise<ExportFile> => {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const isGzip = head[0] === 0x1f && head[1] === 0x8b;
  const text = isGzip ? await (await pipeText(blob, new DecompressionStream('gzip'))).text() : await blob.text();
  return JSON.parse(text) as ExportFile;
};
