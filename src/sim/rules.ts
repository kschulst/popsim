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
  maxAge: 3000,
  agingHazard: 0.000005,
  agingDoubling: 100,
  senescenceOnset: 700,
  senescenceSpan: 600,
  senescenceStrength: 0.6,
  frailtyThreshold: 0.15,
  frailtyHazard: 0.01,
  birthRisk: 0.005,
  infancyTicks: 100,
  infantHazard: 0.0015,
  outbreakRate: 0.0004,
  contagionRadius: 15,
  diseaseMutation: 0.02,
  sicknessCost: 0.04,
  sicknessWeakness: 0.3,
  eleRate: 0.00002,
  eleSeverity: 1,
  eleWeights: { meteor: 1, volcano: 1, plague: 1, iceAge: 1, locusts: 1, drought: 1, infertility: 1, radiation: 1, rage: 1, machines: 1 },
  friction: 0.1,
  steerStrength: 0.25,
  directionNoise: 0.3,
  offspringEnergy: 0.4,
  parentalCostSplit: 0.5,
  mateCooldown: 40,
  maleMateCooldown: 40,
  choosiness: 0.5,
  rejectionCooldown: 15,
  gestationTicks: 30,
  nursingTicks: 30,
  nursingRate: 0.4,
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

type NumericRuleKey = Exclude<keyof Rules, 'surnameRule' | 'kinWeights' | 'tribeBonus' | 'eleWeights'>;

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
      { key: 'foodSpreadRate', label: 'Spredning fra naboer', min: 0, max: 0.2, step: 0.001, description: 'Hvor fort mat sprer seg til tomme ruter fra naboruter med mat.' },
      { key: 'foodSpontaneous', label: 'Spontan vekst', min: 0, max: 0.01, step: 0.0001, description: 'Hvor ofte mat dukker opp i en tom rute uten naboer med mat.' },
      { key: 'foodEnergy', label: 'Energi per matrute', min: 0, max: 200, step: 1, description: 'Energi fra å spise én matrute.' },
    ],
  },
  {
    group: 'Energi og alder',
    fields: [
      { key: 'energyPerSize', label: 'Kapasitet per størrelse', min: 10, max: 500, step: 5, description: 'Hvor mye energi en aktør kan lagre per størrelse.' },
      { key: 'baseCost', label: 'Grunnkostnad', min: 0, max: 1, step: 0.005, description: 'Energi som brukes hver tick bare for å leve. Større aktører bruker mer.' },
      { key: 'moveCost', label: 'Bevegelseskostnad', min: 0, max: 1, step: 0.005, description: 'Energi som brukes på å bevege seg. Dobbel fart koster fire ganger så mye.' },
      { key: 'agingFactor', label: 'Aldringskostnad', min: 0, max: 5, step: 0.1, description: 'Hvor mye dyrere det blir å leve med alderen. 1 = dobbelt så dyrt ved alder 1000.' },
      { key: 'maxAge', label: 'Absolutt maks alder', min: 50, max: 20000, step: 50, description: 'Sikkerhetsgrense: ingen lever lenger enn dette.' },
      { key: 'agingHazard', label: 'Aldersrisiko ved fødsel', min: 0, max: 0.01, step: 0.000001, description: 'Grunnrisiko for å dø av alderdom. Med standardverdier dør halvparten før omtrent 980 ticks.' },
      { key: 'agingDoubling', label: 'Dobling av aldersrisiko', min: 10, max: 1000, step: 5, description: 'Hvor ofte risikoen for å dø av alderdom dobles. Kortere = likere levealder.' },
      { key: 'senescenceOnset', label: 'Svekkelse starter', min: 0, max: 5000, step: 50, description: 'Alder der aktøren begynner å svekkes (fart, syn, styrke, fruktbarhet).' },
      { key: 'senescenceSpan', label: 'Svekkelse varighet', min: 1, max: 5000, step: 50, description: 'Hvor lang tid svekkelsen bruker på å bli full.' },
      { key: 'senescenceStrength', label: 'Svekkelse styrke', min: 0, max: 1, step: 0.05, description: 'Hvor mye svekket en gammel aktør blir. 0,6 = 40 % igjen.' },
      { key: 'frailtyThreshold', label: 'Sultsvekkelse under', min: 0, max: 1, step: 0.01, description: 'Under denne energiandelen kan aktøren dø av sult før energien er tom.' },
      { key: 'frailtyHazard', label: 'Sultsvekkelse risiko', min: 0, max: 0.2, step: 0.001, description: 'Høyeste risiko per tick for å dø av sult når energien er nesten tom.' },
    ],
  },
  {
    group: 'Fysikk',
    fields: [
      { key: 'friction', label: 'Friksjon', min: 0, max: 1, step: 0.01, description: 'Hvor mye fart som går tapt hver tick.' },
      { key: 'steerStrength', label: 'Styrestyrke', min: 0, max: 1, step: 0.01, description: 'Hvor raskt aktøren svinger og endrer fart.' },
      { key: 'directionNoise', label: 'Retningsstøy', min: 0, max: 3, step: 0.05, description: 'Tilfeldig vingling i retningen.' },
    ],
  },
  {
    group: 'Formering',
    fields: [
      { key: 'offspringEnergy', label: 'Barnets startenergi (andel)', min: 0.05, max: 1, step: 0.05, description: 'Barnets startenergi, som andel av barnets kapasitet. Betales av foreldrene.' },
      { key: 'parentalCostSplit', label: 'Andel betalt av hunn', min: 0, max: 1, step: 0.05, description: 'Hvor stor del av barnets energi moren betaler. Resten betaler faren.' },
      { key: 'mateCooldown', label: 'Nedkjøling etter paring (hunn)', min: 0, max: 500, step: 5, description: 'Ticks fra en hunn parer seg til hun kan pare seg igjen (minst svangerskapet). Også minstealder for paring.' },
      { key: 'maleMateCooldown', label: 'Nedkjøling etter paring (hann)', min: 0, max: 500, step: 5, description: 'Ticks en hann må vente mellom paringer. Kort ventetid gir attraktive hanner mange barn.' },
      { key: 'mutationScale', label: 'Mutasjonsskala', min: 0, max: 5, step: 0.1, description: 'Hvor mye barnas egenskaper muterer. 0 = ingen mutasjon.' },
      { key: 'inheritanceNoise', label: 'Tilfeldighet i arv', min: 0, max: 1, step: 0.01, description: 'Hvor tilfeldig barnet arver fra mor og far. Høy = barnet ligner ofte mest på én av dem.' },
      { key: 'ancestrySegments', label: 'Avstamningssegmenter', min: 0, max: 256, step: 1, description: 'Avstamning arves i biter fra mor eller far. Færre biter = søsken blir mer ulike. 0 = nøyaktig snitt.' },
    ],
  },
  {
    group: 'Katastrofer (ELE)',
    fields: [
      { key: 'eleRate', label: 'Katastroferate', min: 0, max: 0.01, step: 0.00001, description: 'Hvor ofte en tilfeldig katastrofe skjer. 0,00002 ≈ én per 50 000 ticks. 0 = aldri.' },
      { key: 'eleSeverity', label: 'Alvorlighet', min: 0.1, max: 5, step: 0.1, description: 'Hvor kraftige og langvarige katastrofene er. 1 = normal.' },
    ],
  },
  {
    group: 'Sykdom',
    fields: [
      { key: 'outbreakRate', label: 'Utbruddsrate', min: 0, max: 0.05, step: 0.0001, description: 'Hvor ofte en ny sykdom bryter ut. 0,0004 ≈ én per 2500 ticks.' },
      { key: 'contagionRadius', label: 'Smitteavstand', min: 0, max: 100, step: 1, description: 'Hvor nær man må være for å bli smittet.' },
      { key: 'diseaseMutation', label: 'Mutasjon ved smitte', min: 0, max: 1, step: 0.005, description: 'Sjanse for at en smitte blir en ny variant av sykdommen.' },
      { key: 'sicknessCost', label: 'Energikostnad ved sykdom', min: 0, max: 1, step: 0.005, description: 'Ekstra energi syke bruker hver tick.' },
      { key: 'sicknessWeakness', label: 'Svekkelse ved sykdom', min: 0, max: 1, step: 0.05, description: 'Hvor mye sykdom svekker fart, syn, styrke og fruktbarhet.' },
    ],
  },
  {
    group: 'Partnervalg',
    fields: [
      { key: 'tribePreference', label: 'Stammepreferanse', min: 0, max: 5, step: 0.1, description: 'Hvor mye aktørene foretrekker partnere fra egen stamme.' },
      { key: 'purityWeight', label: 'Renhetsvekt', min: 0, max: 5, step: 0.1, description: 'Hvor mye renhet betyr for stammepreferansen. 0 = ingen betydning.' },
      { key: 'mateDistanceWeight', label: 'Avstandsvekt', min: 0, max: 3, step: 0.05, description: 'Hvor mye nærhet betyr i valg av partner.' },
      { key: 'minMateScore', label: 'Minste partnerpoeng', min: -2, max: 5, step: 0.05, description: 'Laveste partnerpoeng som godtas. Høyere = strengere krav.' },
      { key: 'choosiness', label: 'Kresenhet', min: 0, max: 10, step: 0.1, description: 'Hvor kresne aktørene er. Høyere = oftere avvisning av mindre attraktive. 0 = godtar alle over grensen.' },
      { key: 'rejectionCooldown', label: 'Ventetid etter avvisning', min: 0, max: 500, step: 5, description: 'Hvor lenge en avvist aktør må vente før den prøver igjen.' },
      { key: 'gestationTicks', label: 'Svangerskap (ticks)', min: 0, max: 500, step: 5, description: 'Hvor lenge et svangerskap varer. Moren trenger mer mat i perioden.' },
      { key: 'nursingTicks', label: 'Ammeperiode (ticks)', min: 0, max: 1000, step: 5, description: 'Hvor lenge barnet ammes. Moren kan ikke bli gravid så lenge.' },
      { key: 'nursingRate', label: 'Amming per tick', min: 0, max: 5, step: 0.05, description: 'Energi barnet får fra moren hver tick mens det ammes.' },
      { key: 'multipleBirthRate', label: 'Flerlingrate', min: 0, max: 0.5, step: 0.005, description: 'Sjanse for tvillinger (trillinger er mye sjeldnere).' },
      { key: 'paternalCare', label: 'Farsomsorg', min: 0, max: 1, step: 0.05, description: 'Sjanse for at faren blir hos den gravide, gir henne mat og forsvarer henne.' },
      { key: 'provisionRate', label: 'Matdeling fra far (energi per tick)', min: 0, max: 10, step: 0.1, description: 'Hvor mye energi far (og slekt) kan gi den gravide per tick.' },
      { key: 'guardDistance', label: 'Vaktavstand', min: 5, max: 200, step: 5, description: 'Hvor nær faren holder seg den gravide.' },
      { key: 'kinCare', label: 'Slektshjelp til gravide', min: 0, max: 5, step: 0.05, description: 'Hvor mye slekten hjelper en gravid. Nærere slekt hjelper mer. 0 = ingen hjelp fra slekt.' },
      { key: 'birthRisk', label: 'Risiko ved fødsel', min: 0, max: 0.5, step: 0.001, description: 'Risiko for at mor eller barn dør ved fødselen. Høyere ved flerlinger og lite energi.' },
      { key: 'infancyTicks', label: 'Spedbarnsperiode', min: 0, max: 1000, step: 10, description: 'Hvor lenge et barn regnes som spedbarn.' },
      { key: 'infantHazard', label: 'Spedbarnsrisiko', min: 0, max: 0.05, step: 0.0005, description: 'Risiko for spedbarnsdød. Lavere når en forelder er i nærheten.' },
      { key: 'kinPenaltyClose', label: 'Slektsstraff: foreldre, barn, helsøsken', min: 0, max: 20, step: 0.5, description: 'Hvor uaktuelt det er å pare seg med forelder, barn eller helsøsken.' },
      { key: 'kinPenaltyHalf', label: 'Slektsstraff: halvsøsken', min: 0, max: 20, step: 0.5, description: 'Hvor uaktuelt det er å pare seg med halvsøsken.' },
      { key: 'kinPenaltySecond', label: 'Slektsstraff: besteforeldre, tanter/onkler', min: 0, max: 20, step: 0.5, description: 'Hvor uaktuelt det er å pare seg med besteforeldre, tanter, onkler, nevøer og nieser.' },
      { key: 'kinPenaltyCousin', label: 'Slektsstraff: fettere/kusiner', min: 0, max: 20, step: 0.5, description: 'Hvor uaktuelt det er å pare seg med fettere og kusiner.' },
    ],
  },
  {
    group: 'Konflikt: angrep',
    fields: [
      { key: 'attackThreshold', label: 'Angrepsterskel', min: 0, max: 3, step: 0.05, description: 'Hvor mye som skal til før en aktør angriper. Høyere = færre angrep.' },
      { key: 'hungerWeight', label: 'Sultvekt', min: 0, max: 3, step: 0.05, description: 'Hvor mye sult øker lysten til å angripe.' },
      { key: 'foodCompetitionWeight', label: 'Matkonkurranse', min: 0, max: 3, step: 0.05, description: 'Hvor mye det øker lysten til å angripe at noen er nærmere maten.' },
      { key: 'rivalryWeight', label: 'Rivalisering', min: 0, max: 3, step: 0.05, description: 'Hvor mye rivalisering om samme partner øker lysten til å angripe.' },
      { key: 'tribeLoyalty', label: 'Stammelojalitet', min: 0, max: 5, step: 0.1, description: 'Hvor mye aktørene skåner og støtter egen stamme.' },
      { key: 'kinLoyalty', label: 'Slektslojalitet', min: 0, max: 5, step: 0.1, description: 'Hvor mye aktørene skåner og støtter slekt.' },
      { key: 'joinThreshold', label: 'Terskel for å blande seg inn', min: 0, max: 3, step: 0.05, description: 'Hvor mye som skal til før en tilskuer blander seg inn i en kamp.' },
    ],
  },
  {
    group: 'Konflikt: kamp og helse',
    fields: [
      { key: 'hpPerSize', label: 'Helse per størrelse', min: 10, max: 500, step: 5, description: 'Helsepoeng per størrelse. Lav helse gjør aktøren tregere og svakere.' },
      { key: 'damageScale', label: 'Skadeskala', min: 0, max: 100, step: 1, description: 'Hvor mye skade et slag gjør. Skaden varierer tilfeldig.' },
      { key: 'attackCooldown', label: 'Ticks mellom slag', min: 1, max: 100, step: 1, description: 'Ticks mellom hvert slag.' },
      { key: 'attackReach', label: 'Rekkevidde', min: 0, max: 20, step: 0.5, description: 'Hvor langt et slag rekker.' },
      { key: 'attackCost', label: 'Energi per slag', min: 0, max: 20, step: 0.5, description: 'Energi et slag koster.' },
      { key: 'fleeRate', label: 'Fluktrate', min: 0, max: 1, step: 0.01, description: 'Hvor lett aktører flykter når de er skadet eller i undertall. Aggressive flykter sjeldnere.' },
      { key: 'fleeDuration', label: 'Fluktvarighet', min: 1, max: 500, step: 5, description: 'Hvor lenge en flukt varer.' },
      { key: 'pursuitGiveUp', label: 'Gi opp forfølgelse', min: 0, max: 1, step: 0.01, description: 'Hvor raskt en angriper gir opp å jage en som flykter.' },
      { key: 'healRate', label: 'Helingsrate', min: 0, max: 0.05, step: 0.0005, description: 'Hvor fort skader leges når aktøren har nok energi.' },
      { key: 'healCost', label: 'Energi per helsepoeng', min: 0, max: 5, step: 0.05, description: 'Energi det koster å lege ett helsepoeng.' },
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
  'Ekstra partnerpoeng etter kandidatens andel fra stammen. 1 gir +1 for en ren aktør, +0,5 for halv. Negativt gjør stammen mindre attraktiv.';

export const SURNAME_RULE_DESCRIPTION =
  'Hvilken forelder barnet får etternavnet fra.';

export const KIN_WEIGHTS_DESCRIPTION =
  'Hvor mye en aktør bryr seg om en slektning (1 = som seg selv). Brukes i lojalitet i kamp og hjelp til gravide.';

export const SURNAME_RULE_LABELS: Record<Rules['surnameRule'], string> = {
  random: 'Tilfeldig forelder',
  mother: 'Mor',
  father: 'Far',
  stronger: 'Forelder med mest energi',
};
