# popsim (Population Sim): design

Interaktiv, agentbasert simulering av en bestand i et 2D-økosystem. Kjører som statisk app i nettleseren. Beslutningene under er tatt i designøktene 2026-11-08 (v1) og 2026-11-10–11 (v2–v3).

## Versjonsplan

Hver versjon er en git-tag (`v1`, `v2` …) og publiseres frosset under `/vN/` på GitHub Pages. En indeksside på `/` lister versjonene.

| Versjon | Innhold |
|---|---|
| v1 | Livssyklus med to kjønn, matfelt, harde kanter, fast atferd, snapshots og grener, endringer ved forgreining, eksport/import, navn og stamtre, statistikk |
| v2 | Stammer med navn, farge og egne verdier, avstamning og renhet, partnervalg med stammepreferanse og slektsstraff, fysisk plass, kamp med helse, flukt og allianser, zoom og kakediagram |
| v3 | Kulturer som oppstår av nærhet og likhet (eksplisitte kulturer med spredte kulturtrekk), `maxCultures` (standard 1), samarbeid og hjelp (energideling, felles forsvar), konflikt mellom kulturer (f.eks. etter drap) |
| v4 | Hukommelse om andre aktører, valgfri arv av hukommelse |
| v5 | Evolverbar atferd: vekter for drivkrefter i genomet |

## Simuleringsmodell

- **Rom**: kontinuerlig 2D-plan med harde kanter. Ved kanten klemmes posisjonen og hastighetskomponenten mot veggen settes til 0.
- **Tid**: diskrete ticks. Aktørene oppdateres sekvensielt i tilfeldig rekkefølge hver tick.
- **Tilfeldighet**: kjøringer er ikke-deterministiske (`Math.random`). Tilfeldighet brukes i retning, mutasjon, kjønn, arv, matvekst og oppdateringsrekkefølge.
- **Miljø**: rutenett (64×48). Hver rute har mat eller ikke (binært), og en fast fruktbarhet (0,2–1). En tom rute får mat med sannsynlighet `fruktbarhet × (foodSpontaneous + foodSpreadRate × antall naboruter med mat)`. Et nedbeitet område gror derfor innover fra kantene, og beiting setter varige spor for senere generasjoner. Å spise tømmer ruten og gir `foodEnergy` energi, begrenset av kapasiteten.
- **Regelbeskrivelser**: hver regel har en beskrivelse i UI-et (hover eller ?-knapp).
- **Energi**: kapasitet = `energyPerSize × size`. Kostnad per tick = `baseCost × size × (1 + agingFactor × alder/maxAge) + moveCost × size × fart²`. Død ved energi ≤ 0 eller alder ≥ `maxAge`.
- **Fysisk plass** (v2): kropper overlapper ikke. Etter bevegelse skyves overlappende aktører fra hverandre, halvparten hver.
- **Formering**: to aktører av motsatt kjønn i kontakt, begge over `reproThreshold × kapasitet`, ingen nedkjøling, ikke i kamp eller på flukt, og partnerpoeng over `minMateScore` (se Partnervalg). Barnets startenergi betales av foreldrene etter `parentalCostSplit` (andel betalt av hunnen). Kjønn trekkes 50/50. Ingen parbinding.
- **Arv**: hver egenskap har en arvestyrke (0,05–1). Barnets verdi er en blanding av foreldrenes, vektet med mors andel av foreldrenes samlede arvestyrke for egenskapen, pluss gaussisk støy (`inheritanceNoise`). Arvestyrken for hver egenskap arves fra én tilfeldig forelder. Deretter muterer begge (standardavvik `mutationRate × intervall × mutationScale`). Hver seed får et eget grunnivå for arvestyrke, så stammene er ulike fra start.
- **Generasjon**: `max(foreldrenes generasjon) + 1`. Seeds har generasjon 0.

### Genom

| Gen | Intervall | Effekt |
|---|---|---|
| `size` | 0,5–3 | energikapasitet, kostnad, radius, maks helse, slagstyrke |
| `maxSpeed` | 0,3–3 | maks fart, treffsjanse |
| `vision` | 10–120 | radius for å se mat, partnere og andre aktører |
| `aggression` (v2) | 0–1 | angrepsvilje, mot (lavere fluktsannsynlighet), vilje til å blande seg i kamper |
| `reproThreshold` | 0,4–0,95 | andel av kapasitet som kreves for paring |
| `mutationRate` | 0,01–0,3 | mutasjonsstyrke, muterer selv |

### Stammer og avstamning (v2)

- En kjøring starter med stammer. Hver stamme har navn, farge, antall seeds og verdier for størrelse, fart, syn og aggresjon, pluss arvelighet (grunnivå for arvestyrke). Paringsterskel og mutasjonsrate er like for alle. Standard er fire stammer med 5 seeds hver:

| Stamme | Størrelse | Fart | Syn | Aggresjon | Arvelighet |
|---|---|---|---|---|---|
| Røde | 2,2 | 1,2 | 60 | 0,7 | 0,7 |
| Blå | 1,0 | 2,4 | 60 | 0,3 | 0,5 |
| Gule | 1,4 | 1,6 | 100 | 0,4 | 0,3 |
| Grønne | 1,5 | 1,7 | 70 | 0,2 | 0,5 |

- Seeds får verdier ±10 % rundt stammens verdier og arvestyrke ±0,1 rundt arveligheten. Hver seed har eget etternavn. Klanfargene ligger innenfor ±30° av stammens fargetone.
- Hver stamme starter samlet i et hjemområde (seeds normalfordelt med standardavvik 40 rundt et punkt på en ellipse rundt sentrum). Uten hjemområder møtte seeds hverandre for sjelden, og 2 av 8 testkjøringer stagnerte.
- **Avstamning**: andel fra hver stamme, summerer til 1. Barnet får gjennomsnittet av foreldrenes.
- **Renhet**: største andel fra én stamme.
- **Felles avstamning** mellom to aktører: `Σ min(aᵢ, bᵢ)`, 1 for samme rene stamme, 0 for helt ulike.

### Partnervalg (v2)

`partnerpoeng = 1 + tribePreference × felles avstamning × (renhet_a × renhet_b)^purityWeight − slektsstraff − mateDistanceWeight × avstand / snitt syn`

I tillegg får kandidaten en bonus for avstamningen sin: `Σ tribeBonus[i] × kandidatens andel fra stamme i` (regel per stamme, standard 0, justerbar under kjøring). a sin vurdering av b legger til b sin bonus, og omvendt. Paring krever at begge vurderingene er minst `minMateScore` (begge må godta). Aktøren går mot kandidaten med høyest poeng. Slektsstraff (erstatter `incestDepth` fra v1):

| Relasjon | Straff |
|---|---|
| Forelder, barn, helsøsken | 10 |
| Halvsøsken | 5 |
| Besteforelder, barnebarn, tante/onkel, nevø/niese | 3 |
| Fetter/kusine | 1 |

### Konflikt (v2)

- **Helse**: maks helse = `hpPerSize × size`. Lav helse senker fart, syn og slagstyrke med faktoren `√(helse/maks)`. Helse leges med `healRate × maks` per tick når energien er over halve kapasiteten, og hvert helsepoeng koster `healCost` energi. Død ved helse ≤ 0 (årsak «drept», drapsmannen lagres).
- **Angrep**: for de 4 nærmeste synlige aktørene regnes `angrepsvilje = aggresjon × (hungerWeight × sult + foodCompetitionWeight × [den andre er nærmere min matrute] + rivalryWeight × [samme kjønn, går mot samme partner]) × 2 × odds − tribeLoyalty × felles avstamning − kinLoyalty × slektsvekt`. Aktøren angriper den med høyest vilje over `attackThreshold`. Odds er egen styrke pluss nærliggende aktører som heller mot meg (felles avstamning, vektet med deres aggresjon), delt på total styrke.
- **Slag**: ett slag per `attackCooldown` ticks innen `attackReach` utover kroppskontakt, koster `attackCost` energi. Treffsjanse `0,6 + 0,3 × (fart_a − fart_b)/(fart_a + fart_b)`, begrenset til 0,2–0,95. Skade `damageScale × styrke × lognormal(0; 0,5)`, der styrke = `size × (0,5 + 0,5 × energiandel) × √(helseandel)`. Antall slag som trengs blir derfor tilfeldig.
- **Forsvar**: den som blir truffet uten å være i kamp, flykter med sannsynlighet `0,5 × (1 − aggresjon) + 0,5 × (1 − helseandel)`, ellers slår den tilbake.
- **Flukt**: i kamp flykter en aktør hver tick med sannsynlighet `fleeRate × (2 × (1 − helseandel) + max(0, overmakt − 0,5)) × (1 − 0,7 × aggresjon)`. Overmakt er motstandernes andel av styrken innen 50 enheter. Flukten varer `fleeDuration` ticks. Forfølgeren gir opp med sannsynlighet `pursuitGiveUp` per tick eller når målet er utenfor 1,5 × syn. Begge kan flykte, og da slutter kampen.
- **Flere deltakere**: en aktør som ser en kamp, velger side når `aggresjon × (lojalitet til den ene − lojalitet til den andre) > joinThreshold`, med lojalitet = `tribeLoyalty × felles avstamning + kinLoyalty × slektsvekt`. Det er ingen grense for antall deltakere. Grupper kan dermed ta ut en sterkere aktør sammen.
- **Kamp om partner**: rivaler (samme kjønn, går mot samme partner) får rivaliseringsleddet i angrepsviljen. Den som når partneren først, parer seg hvis partneren også godtar (partnerpoeng).

### Atferd (fast)

Prioritet hver tick: flykt > kamp (mål) > bli med i en kamp > angrip > paring > mat > vandring.

1. Flykter: beveg deg bort fra den du flykter fra, i full fart.
2. Har mål: styr mot målet i full fart og slå når det er innen rekkevidde.
3. Klar for paring: styr mot partneren med høyest partnerpoeng innenfor syn. Ingen i sikte: vandre i full fart.
4. Ellers: styr mot nærmeste rute med mat innenfor syn.
5. Ingen mat i sikte: tilfeldig vandring.

Retningen får støy (`directionNoise`). Styringen er en akselerasjon mot ønsket hastighet, dempet av `friction`.

### Kulturer og samarbeid (v3, planlagt)

- Kulturer oppstår når aktører har levd nær andre med likhetstrekk (geografi, egenskaper, ikke nødvendigvis stamme). Eksplisitte kulturer med medlemskap, og kulturtrekk som sprer seg mellom naboer. Hver aktør kan være med i inntil `maxCultures` kulturer (standard 1). Barn blir med i foreldrenes kultur.
- Samme kultur: høyere terskel for å angripe, større vilje til å hjelpe (energideling, felles forsvar).
- Fiendskap mellom kulturer øker når et medlem blir drept av en fra en annen kultur.

### Vurdering av andre

Slektsvekter brukes i lojalitet (v2) og i samarbeid (v3). De er naturlover (regler) og endres bare ved forgreining.

| Relasjon | Vekt |
|---|---|
| Barn | 1,2 |
| Seg selv | 1,0 |
| Barnebarn | 0,6 |
| Helsøsken | 0,6 |
| Forelder | 0,5 |
| Halvsøsken | 0,3 |
| Besteforelder | 0,25 |
| Tante/onkel, nevø/niese | 0,25 |
| Fetter/kusine | 0,125 |

## Navn og stamtre

- Navn: `Fornavn Etternavn #id`. Fornavn og etternavn trekkes fra SSBs navnestatistikk (tabell 10501 og 12891), vektet etter hyppighet. Fornavn velges etter kjønn. 15 % får to fornavn (to navn av samme kjønn), i tillegg til bindestreksnavn som finnes i SSB-dataene. `#id` er unik per kjøring.
- Hver seed har eget etternavn. Barnet arver farens etternavn. Regelen `surnameRule` kan settes til `father` (standard), `mother`, `random` eller `stronger`.
- Stamtreregisteret tar vare på alle aktører som har levd. Det er knyttet til grenen og arver foreldregrenens register frem til forgreiningspunktet.
- Slektskap regnes fra stamtreet via nærmeste felles stamfar: dybde 3 i inspektøren, dybde 2 (til og med fettere/kusiner) i partnervalg og konflikt.

## Historikk og grener

- Hver gren holder en ringbuffer med full tilstand for hver av de siste `ringSize` (300) ticks, og et fullt snapshot hver `snapshotInterval` (10) ticks for hele grenen.
- Frem og tilbake går per tick innenfor ringbufferen, ellers per snapshot. Avspilling bakover i tid spiller av lagret historikk. Simulering skjer bare fra enden av en gren.
- **Forgreining** fra et lagret tidspunkt lager en ny gren. Før start kan regler, hele populasjonen, én aktør og miljøet endres. Endringene lagres som beskrivelse på grenen.
- Endring av en regel uten redigeringspanelet lager automatisk en ny gren fra tidspunktet som vises.
- Historikken vises som en tidslinje med én linje per gren og en kobling ved forgreiningspunktet.
- Historikken ligger i minnet. Den kan eksporteres og importeres som komprimert JSON. Filen inneholder versjonsnummeret, og import i en annen versjon gir en advarsel. v2 avviser filer fra v1, fordi aktørene mangler stammer og helse. De kan åpnes i v1 via versjonsvelgeren.

## Visualisering

- Verden: Canvas 2D. Matruter tegnes som skarpe kvadrater (mat/ikke mat). Prikkstørrelse etter `size`. Fargen kan vises etter stamme (største andel, metning etter renhet, standard), klan (etternavn), generasjon, genom eller aggresjon.
- Zoom med musehjulet, panorering ved å dra, dobbeltklikk viser hele verdenen. Fra 3× zoom tegnes alle aktører som kakediagram over avstamningen, med helsebar. Valgt aktør får alltid et kakediagram ved siden av seg.
- Kamp: rød strek fra angriper til mål, hvitt blink ved treff, gul kant på aktører som flykter.
- Grafer og tidslinje: D3 med SVG.
- Inspektør: klikk på en aktør for å se navn, genom, foreldre, barn, søsken og et lite stamtre. Levende slektninger markeres med ring på lerretet.

## Ordliste

- **Aktør**: ett individ i simuleringen.
- **Seed**: aktør i startpopulasjonen, generasjon 0.
- **Generasjon**: antall ledd fra en seed (største av foreldrenes + 1).
- **Klan**: aktører med samme etternavn.
- **Stamme**: gruppe av seeds med felles navn, farge og startverdier.
- **Avstamning**: andel fra hver stamme.
- **Renhet**: største andel fra én stamme.
- **Felles avstamning**: summen av minste andel per stamme for to aktører.
- **Helse**: helsepoeng; 0 betyr død.
- **Tick**: ett tidssteg.
- **Snapshot**: lagret full tilstand for én tick.
- **Gren**: sammenhengende tidslinje av ticks. Starter i en annen grens snapshot eller fra start.
- **Forgreiningspunkt**: tick i foreldregrenen der en gren startet.
- **Slektsvekt**: hvor mye en aktør vektlegger en annens gevinst, etter slektskap.
- **Regel**: global parameter som gjelder alle aktører (naturlov).
