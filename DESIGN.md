# sim-sala-bim: design

Interaktiv, agentbasert simulering av en bestand i et 2D-økosystem. Kjører som statisk app i nettleseren. Beslutningene under er tatt i designøkten 2026-11-08.

## Versjonsplan

Hver versjon er en git-tag (`v1`, `v2` …) og publiseres frosset under `/vN/` på GitHub Pages. En indeksside på `/` lister versjonene.

| Versjon | Innhold |
|---|---|
| v1 | Livssyklus med to kjønn, matfelt, harde kanter, fast atferd, snapshots og grener, endringer ved forgreining, eksport/import, navn og stamtre, statistikk |
| v2 | Fysisk plass (ingen overlapp) og konflikt (angrip / ignorer / flykt) |
| v3 | Slektskap og likhet i vurderingen av andre, samarbeid (energideling, felles forsvar) |
| v4 | Hukommelse om andre aktører, valgfri arv av hukommelse |
| v5 | Evolverbar atferd: vekter for drivkrefter i genomet |

## Simuleringsmodell

- **Rom**: kontinuerlig 2D-plan med harde kanter. Ved kanten klemmes posisjonen og hastighetskomponenten mot veggen settes til 0.
- **Tid**: diskrete ticks. Aktørene oppdateres sekvensielt i tilfeldig rekkefølge hver tick.
- **Tilfeldighet**: kjøringer er ikke-deterministiske (`Math.random`). Tilfeldighet brukes i retning, mutasjon, kjønn, arv, matvekst og oppdateringsrekkefølge.
- **Miljø**: rutenett (64×48). Hver rute har mat eller ikke (binært), og en fast fruktbarhet (0,2–1). En tom rute får mat med sannsynlighet `fruktbarhet × (foodSpontaneous + foodSpreadRate × antall naboruter med mat)`. Et nedbeitet område gror derfor innover fra kantene, og beiting setter varige spor for senere generasjoner. Å spise tømmer ruten og gir `foodEnergy` energi, begrenset av kapasiteten.
- **Regelbeskrivelser**: hver regel har en beskrivelse i UI-et (hover eller ?-knapp).
- **Energi**: kapasitet = `energyPerSize × size`. Kostnad per tick = `baseCost × size × (1 + agingFactor × alder/maxAge) + moveCost × size × fart²`. Død ved energi ≤ 0 eller alder ≥ `maxAge`.
- **Formering**: to aktører av motsatt kjønn i kontakt, begge over `reproThreshold × kapasitet`, ingen nedkjøling og ikke slekt innenfor `incestDepth` ledd. Barnets startenergi betales av foreldrene etter `parentalCostSplit` (andel betalt av hunnen). Kjønn trekkes 50/50. Ingen parbinding.
- **Arv**: uniform crossover per gen, deretter gaussisk mutasjon med standardavvik `mutationRate × genintervall × mutationScale`, klemt til intervallet.
- **Generasjon**: `max(foreldrenes generasjon) + 1`. Seeds har generasjon 0.

### Genom (v1)

| Gen | Intervall | Effekt |
|---|---|---|
| `size` | 0,5–3 | energikapasitet, kostnad, spiserate, radius |
| `maxSpeed` | 0,3–3 | maks fart |
| `vision` | 10–120 | radius for å se mat og partnere |
| `reproThreshold` | 0,4–0,95 | andel av kapasitet som kreves for paring |
| `mutationRate` | 0,01–0,3 | mutasjonsstyrke, muterer selv |

### Atferd (v1, fast)

1. Klar for paring: styr mot nærmeste gyldige partner innenfor `vision`.
2. Ellers: styr mot nærmeste rute med mat innenfor `vision`.
3. Ingen mat i sikte: tilfeldig vandring.

Retningen får støy (`directionNoise`). Styringen er en akselerasjon mot ønsket hastighet, dempet av `friction`.

### Planlagt vurdering av andre (v3+)

`vurdering = slektsvekt + w_likhet × genomlikhet + w_avstamning × [samme etternavn]`

Slektsvekter er naturlover (regler) og endres bare ved forgreining. `w_likhet` og `w_avstamning` blir evolverbare i v5.

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
- Slektskap regnes fra stamtreet ned til dybde 3 via nærmeste felles stamfar.

## Historikk og grener

- Hver gren holder en ringbuffer med full tilstand for hver av de siste `ringSize` (300) ticks, og et fullt snapshot hver `snapshotInterval` (10) ticks for hele grenen.
- Frem og tilbake går per tick innenfor ringbufferen, ellers per snapshot. Avspilling bakover i tid spiller av lagret historikk. Simulering skjer bare fra enden av en gren.
- **Forgreining** fra et lagret tidspunkt lager en ny gren. Før start kan regler, hele populasjonen, én aktør og miljøet endres. Endringene lagres som beskrivelse på grenen.
- Endring av en regel uten redigeringspanelet lager automatisk en ny gren fra tidspunktet som vises.
- Historikken vises som en tidslinje med én linje per gren og en kobling ved forgreiningspunktet.
- Historikken ligger i minnet. Den kan eksporteres og importeres som komprimert JSON. Filen inneholder versjonsnummeret, og import i en annen versjon gir en advarsel.

## Visualisering

- Verden: Canvas 2D. Matruter tegnes som skarpe kvadrater (mat/ikke mat). Prikkstørrelse etter `size`. Fargen kan vises etter avstamning (etternavn, standard), generasjon eller genom.
- Grafer og tidslinje: D3 med SVG.
- Inspektør: klikk på en aktør for å se navn, genom, foreldre, barn, søsken og et lite stamtre. Levende slektninger markeres med ring på lerretet.

## Ordliste

- **Aktør**: ett individ i simuleringen.
- **Seed**: aktør i startpopulasjonen, generasjon 0.
- **Generasjon**: antall ledd fra en seed (største av foreldrenes + 1).
- **Klan**: aktører med samme etternavn.
- **Tick**: ett tidssteg.
- **Snapshot**: lagret full tilstand for én tick.
- **Gren**: sammenhengende tidslinje av ticks. Starter i en annen grens snapshot eller fra start.
- **Forgreiningspunkt**: tick i foreldregrenen der en gren startet.
- **Slektsvekt**: hvor mye en aktør vektlegger en annens gevinst, etter slektskap.
- **Regel**: global parameter som gjelder alle aktører (naturlov).
