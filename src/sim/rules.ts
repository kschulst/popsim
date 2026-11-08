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
  description: string;
}

/** Editable numeric rules, grouped for the UI. */
export const RULE_FIELDS: { group: string; fields: RuleField[] }[] = [
  {
    group: 'Miljø',
    fields: [
      { key: 'foodCap', label: 'Mat-tak per celle', min: 0, max: 50, step: 0.5, description: 'Maks mengde mat en rute kan ha. Ganges med rutens fruktbarhet (0,2–1).' },
      { key: 'foodRegrowRate', label: 'Gjenvekstrate', min: 0, max: 0.2, step: 0.001, description: 'Hvor raskt maten vokser tilbake. Veksten er logistisk: raskest når ruten er halvfull, langsom når den er nesten tom eller nesten full. Derfor tar det lang tid før et nedbeitet område kommer seg.' },
      { key: 'foodSpontaneous', label: 'Spontan vekst', min: 0, max: 0.05, step: 0.0005, description: 'Fast vekst per tick, uavhengig av hvor mye mat som er igjen. Uten denne kan en helt tom rute aldri gro igjen.' },
      { key: 'foodEnergy', label: 'Energi per mat', min: 0, max: 5, step: 0.05, description: 'Energi en aktør får per enhet mat den spiser.' },
    ],
  },
  {
    group: 'Energi og alder',
    fields: [
      { key: 'eatRate', label: 'Spiserate', min: 0, max: 5, step: 0.05, description: 'Maks mengde mat en aktør kan spise per tick, ganget med størrelsen.' },
      { key: 'energyPerSize', label: 'Kapasitet per størrelse', min: 10, max: 500, step: 5, description: 'Energikapasitet per størrelsesenhet. En aktør med størrelse 2 kan lagre dobbelt så mye energi som en med størrelse 1.' },
      { key: 'baseCost', label: 'Grunnkostnad', min: 0, max: 1, step: 0.005, description: 'Energi som brukes hver tick bare for å leve, ganget med størrelsen. Øker med alderen (se aldringsfaktor).' },
      { key: 'moveCost', label: 'Bevegelseskostnad', min: 0, max: 1, step: 0.005, description: 'Energikostnad for bevegelse per tick: verdi × størrelse × fart². Dobbel fart koster fire ganger så mye.' },
      { key: 'agingFactor', label: 'Aldringsfaktor', min: 0, max: 5, step: 0.1, description: 'Hvor mye grunnkostnaden øker med alderen. 1 betyr dobbel grunnkostnad ved maks alder, 0 betyr ingen aldring.' },
      { key: 'maxAge', label: 'Maks alder', min: 50, max: 10000, step: 50, description: 'Alder i ticks der en aktør dør, uansett hvor mye energi den har.' },
    ],
  },
  {
    group: 'Fysikk',
    fields: [
      { key: 'friction', label: 'Friksjon', min: 0, max: 1, step: 0.01, description: 'Andel av farten som går tapt hver tick. Høy friksjon gjør bevegelsene tregere og mer rykkete.' },
      { key: 'steerStrength', label: 'Styrestyrke', min: 0, max: 1, step: 0.01, description: 'Hvor raskt en aktør endrer fart og retning mot målet sitt. 1 betyr umiddelbart, lave verdier gir slakke svinger.' },
      { key: 'directionNoise', label: 'Retningsstøy', min: 0, max: 3, step: 0.05, description: 'Tilfeldig avvik i retningen hver tick (standardavvik i radianer). Høye verdier gjør at aktørene treffer målet sitt dårligere.' },
      { key: 'distancePenalty', label: 'Avstandsstraff (mat)', min: 0, max: 0.5, step: 0.005, description: 'Hvor mye en aktør foretrekker mat nær seg framfor mer mat lenger unna. 0 betyr at den alltid går mot ruten med mest mat innen synsrekkevidde.' },
    ],
  },
  {
    group: 'Formering',
    fields: [
      { key: 'offspringEnergy', label: 'Barnets startenergi (andel)', min: 0.05, max: 1, step: 0.05, description: 'Barnets startenergi, som andel av barnets egen kapasitet. Betales av foreldrene ved paring.' },
      { key: 'parentalCostSplit', label: 'Andel betalt av hunn', min: 0, max: 1, step: 0.05, description: 'Andelen av barnets startenergi som moren betaler. Faren betaler resten. 0,5 betyr likt delt. En skjev fordeling gir ulike strategier for kjønnene.' },
      { key: 'mateCooldown', label: 'Nedkjøling etter paring', min: 0, max: 500, step: 5, description: 'Antall ticks en aktør må vente etter paring før den kan pare seg igjen. Gjelder også nyfødte, som en minstealder for paring.' },
      { key: 'mutationScale', label: 'Mutasjonsskala', min: 0, max: 5, step: 0.1, description: 'Global multiplikator på mutasjonsstyrken. Hver aktørs egen mutasjonsrate ganges med denne. 0 slår av mutasjon.' },
      { key: 'incestDepth', label: 'Incestgrense (ledd)', min: 0, max: 3, step: 1, description: 'Paring er forbudt mellom slektninger med felles stamfar innen så mange ledd. 1 stenger foreldre–barn og søsken. 2 stenger også besteforeldre, tanter/onkler og fettere/kusiner. 0 tillater alt.' },
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

export const SURNAME_RULE_DESCRIPTION =
  'Hvilken forelder barnet arver etternavnet fra. Etternavnet bestemmer klan og fargen i avstamningsvisningen.';

export const KIN_WEIGHTS_DESCRIPTION =
  'Hvor mye en aktør vektlegger en annens gevinst, etter slektskap. 1 betyr like mye som seg selv. Tas i bruk i v3 når aktørene kan samarbeide og dele energi.';

export const SURNAME_RULE_LABELS: Record<Rules['surnameRule'], string> = {
  random: 'Tilfeldig forelder',
  mother: 'Mor',
  father: 'Far',
  stronger: 'Forelder med mest energi',
};
