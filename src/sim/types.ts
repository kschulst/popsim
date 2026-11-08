export type Sex = 'F' | 'M';

export const GENE_KEYS = ['size', 'maxSpeed', 'vision', 'reproThreshold', 'mutationRate'] as const;
export type GeneKey = (typeof GENE_KEYS)[number];
export type Genome = Record<GeneKey, number>;

export type SurnameRule = 'random' | 'mother' | 'father' | 'stronger';

export interface KinWeights {
  child: number;
  self: number;
  grandchild: number;
  fullSibling: number;
  parent: number;
  halfSibling: number;
  grandparent: number;
  auntUncle: number;
  cousin: number;
}

export interface Rules {
  foodSpreadRate: number;
  foodSpontaneous: number;
  foodEnergy: number;
  energyPerSize: number;
  baseCost: number;
  moveCost: number;
  agingFactor: number;
  maxAge: number;
  friction: number;
  steerStrength: number;
  directionNoise: number;
  offspringEnergy: number;
  parentalCostSplit: number;
  mateCooldown: number;
  mutationScale: number;
  incestDepth: number;
  surnameRule: SurnameRule;
  kinWeights: KinWeights;
}

export interface Actor {
  id: number;
  given: string;
  surname: string;
  sex: Sex;
  generation: number;
  parents: [number, number] | null;
  genome: Genome;
  x: number;
  y: number;
  vx: number;
  vy: number;
  wander: number;
  energy: number;
  age: number;
  cooldown: number;
  born: number;
}

export type DeathCause = 'starvation' | 'age' | 'removed';

export interface TickStats {
  tick: number;
  females: number;
  males: number;
  geneMean: Genome;
  geneSd: Genome;
  generationMean: number;
  generationMax: number;
  births: number;
  deathsStarvation: number;
  deathsAge: number;
  surnames: number;
  food: number;
}

export interface World {
  tick: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  cellSize: number;
  /** 1 if the cell has food, 0 if empty. */
  food: Uint8Array;
  fertility: Float32Array;
  actors: Actor[];
  nextId: number;
  rules: Rules;
  /** Hue (0–360) per surname, assigned to seeds. */
  surnameHues: Record<string, number>;
}

/** Events produced by one tick, consumed by the genealogy registry and stats. */
export interface TickEvents {
  births: Actor[];
  deaths: { id: number; cause: DeathCause }[];
}
