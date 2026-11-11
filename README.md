# popsim (Population Sim)

Agentbasert simulering av en bestand i et 2D-økosystem. Aktørene lever, spiser, parer seg og dør etter enkle regler med mye tilfeldighet. Du kan spole i historikken, forgreine fra et tidligere tidspunkt med endrede regler, aktører eller miljø, og sammenligne hvordan grenene utvikler seg.

**Kjør den i nettleseren: https://kschulst.github.io/popsim/**

Designbeslutninger og versjonsplan: [DESIGN.md](DESIGN.md).

## Versjoner

Hver versjon er frosset og kan fortsatt kjøres. Fullstendige endringslister står i [versions.json](versions.json).

### [v2: Stammer, partnervalg og kamp](https://kschulst.github.io/popsim/v2/)

- Fire stammer (Røde, Blå, Gule, Grønne) med egne verdier for størrelse, fart, syn, aggresjon og arvelighet. De starter i hvert sitt hjemområde og kan endres i «Ny kjøring».
- Hver aktør har en avstamning (andel fra hver stamme) og en renhet. Avstamningen vises som kakediagram i inspektøren og for alle aktører ved zoom.
- Partnervalg: aktørene foretrekker egen stamme, sterkere jo renere begge er. Nær slekt gir stor straff.
- Fysisk plass og kamp om mat og partnere: helse, tilfeldig skade, flukt, forfølgelse og tilskuere som velger side. Høyere terskel for å angripe egen stamme og slekt.
- Zoom og panorering, dødsårsak «drept» med drapsmann, grafer for stammeandel, renhet og kamp, og tall for andel døde av alderdom og snitt dødsalder.

### [v1: Livssyklus, to kjønn og grener](https://kschulst.github.io/popsim/v1/)

- Aktører med energi, alder, kjønn og genom (størrelse, fart, syn, paringsterskel, mutasjonsrate).
- Binær mat per rute som sprer seg fra naboruter etter et fruktbarhetskart.
- Barn får en vektet blanding av foreldrenes egenskaper etter arvestyrke per egenskap, pluss mutasjon. Norske navn fra SSB, farens etternavn og stamtre.
- Historikk med spoling, forgreining med endrede regler, aktører eller miljø, tidslinje over grener, eksport og import.

[dev](https://kschulst.github.io/popsim/dev/) er siste bygg fra `main` og kan endre seg uten varsel.

### Bytte mellom versjoner

På nettsiden har hver versjon knappen «Versjon: …» nederst til venstre. Panelet lenker til de andre versjonene, og under «Forskjeller» velger du to versjoner for å se hva som er endret mellom dem. Kjøringen følger ikke med når du bytter, så eksporter først hvis du vil ta vare på den. Eksportfiler må åpnes i samme hovedversjon som de ble laget i.

[Indekssiden](https://kschulst.github.io/popsim/) lister alle versjonene med endringer.

## Kjøre lokalt

```sh
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # typesjekk + produksjonsbygg i dist/
```

## Bruk

- Mellomrom: spill/pause. Piltaster: ett steg frem/tilbake.
- Klikk på en aktør for å se avstamning, genom, helse, kamp, foreldre, søsken, barn og stamtre. Levende slektninger får en gul ring.
- Rull for å zoome, dra for å flytte, dobbeltklikk for å se hele verdenen.
- «Forgrein herfra» åpner redigering av regler, populasjon, valgt aktør og miljø (pensel). «Start gren» lager en ny gren i historikken.
- Endring av en regel i Regler-fanen utenfor redigering lager en ny gren automatisk.
- Klikk i tidslinjen eller i en graf for å hoppe i tid.
- Eksporter lagrer hele historikken som `.json.gz`. Importer laster den inn igjen.

## Navn

Aktørene får norske fornavn (etter kjønn) og etternavn fra SSBs navnestatistikk, vektet etter hvor mange som har navnet: [tabell 10501](https://www.ssb.no/statbank/table/10501) (fornavn) og [tabell 12891](https://www.ssb.no/statbank/table/12891) (etternavn brukt av 200 eller flere). Dataene ligger i `src/sim/data/ssb-names.json` og oppdateres med `node scripts/fetch-names.mjs`. Lisens: CC BY 4.0.

## Bygge og publisere versjoner

Hver versjon er en git-tag `vN` og står i `versions.json`. `node scripts/build-site.mjs` bygger alle tagger til `site/vN/`, main til `site/dev/` og en indeksside. GitHub Actions (`.github/workflows/pages.yml`) kjører skriptet og publiserer til GitHub Pages ved push til main og ved nye tagger.

Hver bygde versjon får en versjonsvelger nederst til venstre (`scripts/site/switcher.js`, lagt inn av byggeskriptet). Den lenker til de andre versjonene og viser endringene mellom to valgte versjoner, hentet fra `changes` i `versions.json`. `npm run site` bygger alt og starter en lokal forhåndsvisning på http://localhost:5180/.

`versions.json` har `versions` (frosne versjoner, hver med `changes` mot forrige versjon) og `dev` (endringer på main siden siste versjon). Før du legger til noe på main, før det opp i `dev.changes`.

For å fryse en ny versjon: flytt `dev.changes` inn i en ny oppføring i `versions` og tøm `dev.changes`, legg til versjonen under «Versjoner» øverst i denne filen, commit og tag `vN`, push taggen. Øk deretter `VERSION` i `src/version.ts` på main for neste versjon.
