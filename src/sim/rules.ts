import type { KinWeights, Rules } from './types';

export const DEFAULT_KIN_WEIGHTS: KinWeights = {
  child: 1.2,
  self: 1.0,
  grandchild: 0.6,
  fullSibling: 0.6,
  parent: 0.5,
  halfSibling: 0.3,
  grandparent: 0.25,
  auntUncle: 0.25,
  cousin: 0.125,
};

export const DEFAULT_RULES: Rules = {
  foodCap: 8,
  foodRegrowRate: 0.015,
  foodSpontaneous: 0.002,
  foodEnergy: 1,
  eatRate: 1,
  energyPerSize: 100,
  baseCost: 0.08,
  moveCost: 0.05,
  agingFactor: 1,
  maxAge: 1000,
  friction: 0.1,
  steerStrength: 0.25,
  directionNoise: 0.3,
  distancePenalty: 0.02,
  offspringEnergy: 0.4,
  parentalCostSplit: 0.5,
  mateCooldown: 40,
  mutationScale: 1,
  incestDepth: 1,
  surnameRule: 'random',
  kinWeights: { ...DEFAULT_KIN_WEIGHTS },
};

type NumericRuleKey = Exclude<keyof Rules, 'surnameRule' | 'kinWeights'>;

export interface RuleField {
  key: NumericRuleKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Editable numeric rules, grouped for the UI. */
export const RULE_FIELDS: { group: string; fields: RuleField[] }[] = [
  {
    group: 'Miljø',
    fields: [
      { key: 'foodCap', label: 'Mat-tak per celle', min: 0, max: 50, step: 0.5 },
      { key: 'foodRegrowRate', label: 'Gjenvekstrate', min: 0, max: 0.2, step: 0.001 },
      { key: 'foodSpontaneous', label: 'Spontan vekst', min: 0, max: 0.05, step: 0.0005 },
      { key: 'foodEnergy', label: 'Energi per mat', min: 0, max: 5, step: 0.05 },
    ],
  },
  {
    group: 'Energi og alder',
    fields: [
      { key: 'eatRate', label: 'Spiserate', min: 0, max: 5, step: 0.05 },
      { key: 'energyPerSize', label: 'Kapasitet per størrelse', min: 10, max: 500, step: 5 },
      { key: 'baseCost', label: 'Grunnkostnad', min: 0, max: 1, step: 0.005 },
      { key: 'moveCost', label: 'Bevegelseskostnad', min: 0, max: 1, step: 0.005 },
      { key: 'agingFactor', label: 'Aldringsfaktor', min: 0, max: 5, step: 0.1 },
      { key: 'maxAge', label: 'Maks alder', min: 50, max: 10000, step: 50 },
    ],
  },
  {
    group: 'Fysikk',
    fields: [
      { key: 'friction', label: 'Friksjon', min: 0, max: 1, step: 0.01 },
      { key: 'steerStrength', label: 'Styrestyrke', min: 0, max: 1, step: 0.01 },
      { key: 'directionNoise', label: 'Retningsstøy', min: 0, max: 3, step: 0.05 },
      { key: 'distancePenalty', label: 'Avstandsstraff (mat)', min: 0, max: 0.5, step: 0.005 },
    ],
  },
  {
    group: 'Formering',
    fields: [
      { key: 'offspringEnergy', label: 'Barnets startenergi (andel)', min: 0.05, max: 1, step: 0.05 },
      { key: 'parentalCostSplit', label: 'Andel betalt av hunn', min: 0, max: 1, step: 0.05 },
      { key: 'mateCooldown', label: 'Nedkjøling etter paring', min: 0, max: 500, step: 5 },
      { key: 'mutationScale', label: 'Mutasjonsskala', min: 0, max: 5, step: 0.1 },
      { key: 'incestDepth', label: 'Incestgrense (ledd)', min: 0, max: 3, step: 1 },
    ],
  },
];

export const KIN_WEIGHT_LABELS: Record<keyof KinWeights, string> = {
  child: 'Barn',
  self: 'Seg selv',
  grandchild: 'Barnebarn',
  fullSibling: 'Helsøsken',
  parent: 'Forelder',
  halfSibling: 'Halvsøsken',
  grandparent: 'Besteforelder',
  auntUncle: 'Tante/onkel, nevø/niese',
  cousin: 'Fetter/kusine',
};

export const SURNAME_RULE_LABELS: Record<Rules['surnameRule'], string> = {
  random: 'Tilfeldig forelder',
  mother: 'Mor',
  father: 'Far',
  stronger: 'Forelder med mest energi',
};
