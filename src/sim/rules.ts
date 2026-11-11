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
  foodSpreadRate: 0.006,
  foodSpontaneous: 0.0003,
  foodEnergy: 12,
  energyPerSize: 100,
  baseCost: 0.08,
  moveCost: 0.05,
  agingFactor: 1,
  maxAge: 1000,
  friction: 0.1,
  steerStrength: 0.25,
  directionNoise: 0.3,
  offspringEnergy: 0.4,
  parentalCostSplit: 0.5,
  mateCooldown: 40,
  maleMateCooldown: 40,
  choosiness: 1,
  rejectionCooldown: 15,
  gestationTicks: 40,
  multipleBirthRate: 0.03,
  paternalCare: 0.7,
  provisionRate: 0.5,
  guardDistance: 30,
  kinCare: 0.5,
  mutationScale: 1,
  inheritanceNoise: 0.15,
  ancestrySegments: 16,
  tribePreference: 1.5,
  purityWeight: 1,
  mateDistanceWeight: 0.5,
  minMateScore: 0.6,
  tribeBonus: [],
  kinPenaltyClose: 10,
  kinPenaltyHalf: 5,
  kinPenaltySecond: 3,
  kinPenaltyCousin: 1,
  attackThreshold: 0.3,
  hungerWeight: 1.5,
  foodCompetitionWeight: 0.5,
  rivalryWeight: 0.8,
  tribeLoyalty: 0.6,
  kinLoyalty: 1,
  joinThreshold: 0.3,
  hpPerSize: 100,
  damageScale: 12,
  attackCooldown: 8,
  attackReach: 2,
  attackCost: 1,
  fleeRate: 0.15,
  fleeDuration: 60,
  pursuitGiveUp: 0.04,
  healRate: 0.002,
  healCost: 0.2,
  surnameRule: 'father',
  kinWeights: { ...DEFAULT_KIN_WEIGHTS },
};

type NumericRuleKey = Exclude<keyof Rules, 'surnameRule' | 'kinWeights' | 'tribeBonus'>;

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
      { key: 'foodSpreadRate', label: 'Spredning fra naboer', min: 0, max: 0.2, step: 0.001, description: 'Sannsynlighet per tick for at en tom rute får mat, per naborute (av 8) som har mat. Ganges med rutens fruktbarhet. Et nedbeitet område gror derfor innover fra kantene.' },
      { key: 'foodSpontaneous', label: 'Spontan vekst', min: 0, max: 0.01, step: 0.0001, description: 'Sannsynlighet per tick for at en tom rute får mat uten naboer med mat. Ganges med fruktbarheten. Uten denne kan et helt nedbeitet område aldri gro igjen.' },
      { key: 'foodEnergy', label: 'Energi per matrute', min: 0, max: 200, step: 1, description: 'Energi en aktør får når den spiser maten i en rute. Ruten blir tom. Energien over kapasiteten går tapt.' },
    ],
  },
  {
    group: 'Energi og alder',
    fields: [
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
    ],
  },
  {
    group: 'Formering',
    fields: [
      { key: 'offspringEnergy', label: 'Barnets startenergi (andel)', min: 0.05, max: 1, step: 0.05, description: 'Barnets startenergi, som andel av barnets egen kapasitet. Betales av foreldrene ved paring.' },
      { key: 'parentalCostSplit', label: 'Andel betalt av hunn', min: 0, max: 1, step: 0.05, description: 'Andelen av barnets startenergi som moren betaler. Faren betaler resten. 0,5 betyr likt delt. En skjev fordeling gir ulike strategier for kjønnene.' },
      { key: 'mateCooldown', label: 'Nedkjøling etter paring (hunn)', min: 0, max: 500, step: 5, description: 'Antall ticks fra en hunn parer seg til hun kan pare seg igjen, inkludert svangerskapet (minst svangerskapets lengde). Gjelder også nyfødte hunner, som en minstealder for paring.' },
      { key: 'maleMateCooldown', label: 'Nedkjøling etter paring (hann)', min: 0, max: 500, step: 5, description: 'Antall ticks en hann må vente etter paring. Gjelder også nyfødte hanner. Kortere nedkjøling enn hunnene, gjerne sammen med høy «Andel betalt av hunn», gjør hunnene til den knappe ressursen: attraktive hanner får mange paringer, andre få.' },
      { key: 'mutationScale', label: 'Mutasjonsskala', min: 0, max: 5, step: 0.1, description: 'Global multiplikator på mutasjonsstyrken. Hver aktørs egen mutasjonsrate ganges med denne. 0 slår av mutasjon.' },
      { key: 'inheritanceNoise', label: 'Tilfeldighet i arv', min: 0, max: 1, step: 0.01, description: 'Hvor mye barnets blanding av foreldrene varierer. Uten støy får barnet en blanding vektet etter foreldrenes arvestyrke for hver egenskap. Med støy kan barnet noen ganger ligne mest på én av foreldrene. 0,15 betyr at vekten typisk avviker med ±0,15.' },
      { key: 'ancestrySegments', label: 'Avstamningssegmenter', min: 0, max: 256, step: 1, description: 'Avstamningen arves i så mange like store segmenter, hvert fra mor eller far tilfeldig. Barnets andel fra mor blir da tilfeldig rundt 50 %: med 16 segmenter typisk 50 ± 12 %. Søsken blir ulike, og blandede bestander beholder variasjon som partnervalg og bonus kan virke på. Færre segmenter gir større variasjon. 0 gir nøyaktig gjennomsnitt av foreldrene (som i v2), og da jevnes forskjellene ut for hver generasjon.' },
    ],
  },
  {
    group: 'Partnervalg',
    fields: [
      { key: 'tribePreference', label: 'Stammepreferanse', min: 0, max: 5, step: 0.1, description: 'Partnerpoeng = 1 + stammepreferanse × felles avstamning × (renhet a × renhet b)^renhetsvekt − slektsstraff − avstandsvekt × avstand/syn. Felles avstamning er summen av minste andel per stamme (1 for samme stamme, 0 for helt ulike). Høyere verdi gjør at aktørene foretrekker sin egen stamme sterkere.' },
      { key: 'purityWeight', label: 'Renhetsvekt', min: 0, max: 5, step: 0.1, description: 'Eksponent på renhet i stammeleddet. Renhet er største andel fra én stamme. 0 ignorerer renhet; høyere verdier gjør at utvannede aktører får mindre ut av felles avstamning.' },
      { key: 'mateDistanceWeight', label: 'Avstandsvekt', min: 0, max: 3, step: 0.05, description: 'Poeng som trekkes per synsvidde i avstand til kandidaten. Gjør at nære kandidater foretrekkes.' },
      { key: 'minMateScore', label: 'Minste partnerpoeng', min: -2, max: 5, step: 0.05, description: 'Laveste poeng begge parter godtar. Med standardverdier godtas en fremmed stamme bare når den er nær, mens egen stamme nesten alltid godtas.' },
      { key: 'choosiness', label: 'Kresenhet', min: 0, max: 10, step: 0.1, description: 'Når to møtes, godtar hver av dem den andre med sannsynlighet 1 − e^(−(poeng − minste partnerpoeng) / kresenhet). Med kresenhet 1 godtas en kandidat 1 poeng over grensen i 63 % av møtene og 2 poeng over i 86 %. Den som blir avvist, må vente (se Ventetid etter avvisning), og den som avviste, ser bort fra kandidaten i 4 × ventetiden. Lite attraktive aktører blir oftere avvist og får færre barn. 0 godtar alle over grensen.' },
      { key: 'rejectionCooldown', label: 'Ventetid etter avvisning', min: 0, max: 500, step: 5, description: 'Ticks en avvist aktør må vente før den kan forsøke å pare seg igjen.' },
      { key: 'gestationTicks', label: 'Svangerskap (ticks)', min: 0, max: 500, step: 5, description: 'Ticks fra paring til fødsel. Faren betaler sin del av barnets startenergi ved paringen. Moren betaler sin del jevnt fordelt over svangerskapet, så hun trenger mer mat mens hun er gravid. Dør hun, dør fostrene. Hun kan ikke pare seg igjen før både svangerskapet og nedkjølingen (regnet fra paringen) er over.' },
      { key: 'multipleBirthRate', label: 'Flerlingrate', min: 0, max: 0.5, step: 0.005, description: 'Sannsynlighet for hvert ekstra barn: tvillinger med sannsynlighet p, trillinger p², firlinger p³ (maks 4). 0,03 gir tvillinger i 3 % og trillinger i 0,09 % av svangerskapene. Søsken arver hver for seg (toeggede), og hvert barn koster full startenergi.' },
      { key: 'paternalCare', label: 'Farsomsorg', min: 0, max: 1, step: 0.05, description: 'Sannsynlighet for at faren blir hos den gravide moren til fødselen. Han holder seg innen vaktavstanden, gir henne energi når hun trenger det og angriper den som angriper henne. Mens han passer på, parer han seg ikke med andre.' },
      { key: 'provisionRate', label: 'Matdeling fra far (energi per tick)', min: 0, max: 10, step: 0.1, description: 'Energi en omsorgsfull far gir moren per tick når han er innen vaktavstanden, har mer enn halve kapasiteten og hun har under 80 % av sin. 10 % går tapt i overføringen.' },
      { key: 'guardDistance', label: 'Vaktavstand', min: 5, max: 200, step: 5, description: 'Hvor nær en omsorgsfull far holder seg den gravide moren.' },
      { key: 'kinCare', label: 'Slektshjelp til gravide', min: 0, max: 5, step: 0.05, description: 'Slektninger hjelper en gravid kvinne med vekt = slektshjelp × slektsvekt (se Slektsvekter). Faren som passer på henne har vekt 1. Med standardverdiene: hennes barn 0,25, foreldre 0,6, søsken 0,3, fettere/kusiner 0,06. Hjelperne innen vaktavstanden gir henne energi (matdeling × vekt), forsvarer henne når hun blir angrepet, og kan angripe andre i nærheten av henne når hun er sulten (sultvekt × hennes sult × vekt i angrepsviljen). Den som hjelper mest av flere gravide, hjelper den med størst vekt. 0 slår av slektshjelp.' },
      { key: 'kinPenaltyClose', label: 'Slektsstraff: foreldre, barn, helsøsken', min: 0, max: 20, step: 0.5, description: 'Trekk i partnerpoeng for forelder, barn og helsøsken.' },
      { key: 'kinPenaltyHalf', label: 'Slektsstraff: halvsøsken', min: 0, max: 20, step: 0.5, description: 'Trekk i partnerpoeng for halvsøsken.' },
      { key: 'kinPenaltySecond', label: 'Slektsstraff: besteforeldre, tanter/onkler', min: 0, max: 20, step: 0.5, description: 'Trekk i partnerpoeng for besteforeldre, barnebarn, tanter/onkler og nevøer/nieser.' },
      { key: 'kinPenaltyCousin', label: 'Slektsstraff: fettere/kusiner', min: 0, max: 20, step: 0.5, description: 'Trekk i partnerpoeng for fettere og kusiner. Fjernere slekt straffes ikke.' },
    ],
  },
  {
    group: 'Konflikt: angrep',
    fields: [
      { key: 'attackThreshold', label: 'Angrepsterskel', min: 0, max: 3, step: 0.05, description: 'Angrepsvilje = aggresjon × (sultvekt × sult + matkonkurranse + rivalisering) × 2 × odds − stammelojalitet × felles avstamning − slektslojalitet × slektsvekt. Aktøren angriper når viljen er over terskelen. Odds er egen styrke pluss alliertes delt på total styrke i nærheten.' },
      { key: 'hungerWeight', label: 'Sultvekt', min: 0, max: 3, step: 0.05, description: 'Vekt på sult (1 − energi/kapasitet) i angrepsviljen.' },
      { key: 'foodCompetitionWeight', label: 'Matkonkurranse', min: 0, max: 3, step: 0.05, description: 'Bidrag til angrepsviljen når den andre er nærmere matruten aktøren går mot.' },
      { key: 'rivalryWeight', label: 'Rivalisering', min: 0, max: 3, step: 0.05, description: 'Bidrag til angrepsviljen mot en av samme kjønn som går mot samme partner.' },
      { key: 'tribeLoyalty', label: 'Stammelojalitet', min: 0, max: 5, step: 0.1, description: 'Trekk i angrepsviljen per andel felles avstamning. Gir høyere terskel for å angripe egen stamme. Brukes også når tilskuere velger side.' },
      { key: 'kinLoyalty', label: 'Slektslojalitet', min: 0, max: 5, step: 0.1, description: 'Trekk i angrepsviljen ganget med slektsvekten (se Slektsvekter). Brukes også når tilskuere velger side.' },
      { key: 'joinThreshold', label: 'Terskel for å blande seg inn', min: 0, max: 3, step: 0.05, description: 'En tilskuer går inn i en kamp på den ene sidens side når aggresjon × (lojalitet til den ene − lojalitet til den andre) er over terskelen. Lojalitet = stammelojalitet × felles avstamning + slektslojalitet × slektsvekt.' },
    ],
  },
  {
    group: 'Konflikt: kamp og helse',
    fields: [
      { key: 'hpPerSize', label: 'Helse per størrelse', min: 10, max: 500, step: 5, description: 'Maks helsepoeng per størrelsesenhet. Lav helse senker fart, syn og slagstyrke med faktoren √(helse/maks).' },
      { key: 'damageScale', label: 'Skadeskala', min: 0, max: 100, step: 1, description: 'Skade per treff = skadeskala × styrke × tilfeldig faktor (lognormal, median 1). Styrke = størrelse × (0,5 + 0,5 × energiandel) × √(helseandel).' },
      { key: 'attackCooldown', label: 'Ticks mellom slag', min: 1, max: 100, step: 1, description: 'Ticks en aktør må vente mellom to slag.' },
      { key: 'attackReach', label: 'Rekkevidde', min: 0, max: 20, step: 0.5, description: 'Avstand utover kroppskontakt der et slag kan treffe.' },
      { key: 'attackCost', label: 'Energi per slag', min: 0, max: 20, step: 0.5, description: 'Energi et slag koster, enten det treffer eller ikke.' },
      { key: 'fleeRate', label: 'Fluktrate', min: 0, max: 1, step: 0.01, description: 'Sannsynlighet per tick for å flykte = fluktrate × (2 × (1 − helseandel) + overmakt) × (1 − 0,7 × aggresjon). Overmakt er motstandernes andel av styrken over 0,5.' },
      { key: 'fleeDuration', label: 'Fluktvarighet', min: 1, max: 500, step: 5, description: 'Antall ticks en aktør flykter før den kan gjøre noe annet.' },
      { key: 'pursuitGiveUp', label: 'Gi opp forfølgelse', min: 0, max: 1, step: 0.01, description: 'Sannsynlighet per tick for å slutte å jage et mål som flykter.' },
      { key: 'healRate', label: 'Helingsrate', min: 0, max: 0.05, step: 0.0005, description: 'Andel av maks helse som leges per tick når aktøren har mer enn halve energikapasiteten.' },
      { key: 'healCost', label: 'Energi per helsepoeng', min: 0, max: 5, step: 0.05, description: 'Energi som brukes per helsepoeng som leges.' },
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

export const TRIBE_BONUS_DESCRIPTION =
  'Ekstra partnerpoeng for kandidater, vektet med kandidatens andel fra hver stamme. Med bonus 1 for en stamme får en ren aktør fra stammen +1 poeng, en med halv avstamning +0,5. Negative verdier gjør avstamningen mindre attraktiv. Bonusen gjelder når hvem som helst vurderer kandidaten, også stammens egne. Begge parter må fortsatt nå minste partnerpoeng.';

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
