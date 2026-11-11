export type Sex = 'F' | 'M';

export const GENE_KEYS = ['size', 'maxSpeed', 'vision', 'aggression', 'reproThreshold', 'mutationRate'] as const;
export type GeneKey = (typeof GENE_KEYS)[number];
export type Genome = Record<GeneKey, number>;
/** Per-gene inheritance strength (0.05–1): how strongly the gene value is passed on to children. */
export type Dominance = Record<GeneKey, number>;

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
  /** Cooldown after mating for females (and the minimum mating age of newborn females). */
  mateCooldown: number;
  /** Cooldown after mating for males (and the minimum mating age of newborn males). */
  maleMateCooldown: number;
  /** How hard partners are to please: acceptance = 1 − exp(−(score − min) / choosiness). 0 accepts every score ≥ min. */
  choosiness: number;
  /** Ticks a rejected actor must wait before it can try to mate again. */
  rejectionCooldown: number;
  /** Ticks from conception to birth. */
  gestationTicks: number;
  /** Probability of each additional child: twins p, triplets p², … (at most 4). */
  multipleBirthRate: number;
  /** Probability that the father stays to guard and feed the pregnant mother. */
  paternalCare: number;
  /** Energy per tick a caring father can give the mother (10 % is lost in the transfer). */
  provisionRate: number;
  /** A caring father keeps within this distance of the mother. */
  guardDistance: number;
  /** Multiplier on kin weight for relatives helping a pregnant female (the caring father has weight 1). */
  kinCare: number;
  mutationScale: number;
  inheritanceNoise: number;
  /** Ancestry is inherited in this many random segments (0 = exact mean of the parents). */
  ancestrySegments: number;
  /** Partner choice: weight of shared tribe ancestry in the mate score. */
  tribePreference: number;
  /** Exponent on (purity a × purity b) in the tribe term. 0 ignores purity. */
  purityWeight: number;
  /** Score lost per vision length of distance to the candidate. */
  mateDistanceWeight: number;
  /** Lowest mate score both partners accept. */
  minMateScore: number;
  /**
   * Extra attractiveness per tribe (index into World.tribes). A candidate's bonus is the sum of
   * bonus × its ancestry share from each tribe. Missing entries count as 0.
   */
  tribeBonus: number[];
  kinPenaltyClose: number;
  kinPenaltyHalf: number;
  kinPenaltySecond: number;
  kinPenaltyCousin: number;
  /** Conflict. */
  attackThreshold: number;
  hungerWeight: number;
  foodCompetitionWeight: number;
  rivalryWeight: number;
  tribeLoyalty: number;
  kinLoyalty: number;
  joinThreshold: number;
  hpPerSize: number;
  damageScale: number;
  attackCooldown: number;
  attackReach: number;
  attackCost: number;
  fleeRate: number;
  fleeDuration: number;
  pursuitGiveUp: number;
  healRate: number;
  healCost: number;
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
  dominance: Dominance;
  /** Share of ancestry from each starting tribe (index into World.tribes); sums to 1. */
  ancestry: number[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  wander: number;
  energy: number;
  age: number;
  cooldown: number;
  born: number;
  /** Health points; maximum is hpPerSize × size. 0 means dead. */
  hp: number;
  /** Actor being fought (attacked or chased), or null. */
  target: number | null;
  /** Ticks left of fleeing, and from whom. */
  fleeing: number;
  fleeFrom: number | null;
  /** Ticks until the next attack is possible. */
  attackCd: number;
  /** Partner this actor is currently heading for (used to detect rivals). */
  mateTarget: number | null;
  /** Last candidate this actor rejected; skipped when choosing a partner for `snubTtl` ticks. */
  snub: number | null;
  snubTtl: number;
  /** Latest courtship this actor started, shown in the renderer for `ttl` ticks. */
  court: Courtship | null;
  /** Set on a pregnant female. */
  pregnancy: Pregnancy | null;
  /** Pregnant mother this male guards and feeds, or null. */
  caresFor: number | null;
  lastHitBy: number | null;
  /** Ticks left of the hit flash in the renderer. */
  flash: number;
  damageDealt: number;
  damageTaken: number;
  kills: number;
}

/** A child conceived but not yet born; its genes are fixed at conception. */
export interface Embryo {
  genome: Genome;
  dominance: Dominance;
  ancestry: number[];
  sex: Sex;
  surname: string;
  /** Energy the child should be born with (offspringEnergy × capacity). */
  energy: number;
}

export interface Pregnancy {
  father: number;
  due: number;
  generation: number;
  embryos: Embryo[];
  /** Energy paid by the father at conception. */
  fatherPaid: number;
  /** Energy the mother pays over the pregnancy, and how much she has paid so far. */
  motherNeed: number;
  motherPaid: number;
}

export interface Courtship {
  with: number;
  /** Whether each side accepted. Both true means they mated. */
  selfAccepted: boolean;
  otherAccepted: boolean;
  ttl: number;
}

export interface Tribe {
  name: string;
  /** Hex colour, e.g. #d9534f. */
  color: string;
  /** Starting genome; seeds vary ±10 % around it. */
  genome: Genome;
  /** Base inheritance strength (0.05–1) for all genes of the tribe's seeds. */
  heritability: number;
  seeds: number;
}

export type DeathCause = 'starvation' | 'age' | 'killed' | 'removed';

export interface TickStats {
  tick: number;
  females: number;
  males: number;
  geneMean: Genome;
  geneSd: Genome;
  dominanceMean: Dominance;
  generationMean: number;
  generationMax: number;
  births: number;
  deathsStarvation: number;
  deathsAge: number;
  deathsKilled: number;
  /** Embryos lost because the mother died while pregnant. */
  pregnancyLosses: number;
  /** Females currently pregnant. */
  pregnant: number;
  /** Successful attacks this tick. */
  hits: number;
  /** Mean ancestry share per tribe among the living. */
  tribeShare: number[];
  /** Mean purity (largest ancestry share) among the living. */
  purityMean: number;
  /** Sum of ages (ticks) of actors who died of starvation, age or were killed this tick. */
  deathAgeSum: number;
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
  tribes: Tribe[];
}

/** Events produced by one tick, consumed by the genealogy registry and stats. */
export interface TickEvents {
  births: Actor[];
  deaths: TickDeath[];
  hits: number;
  pregnancyLosses: number;
}

export interface TickDeath {
  id: number;
  cause: DeathCause;
  age: number;
  killer?: number;
}
