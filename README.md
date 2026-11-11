# popsim (Population Sim)

Agentbasert simulering av en bestand i et 2D-økosystem. Aktørene lever, spiser, parer seg og dør etter enkle regler med mye tilfeldighet. Du kan spole i historikken, forgreine fra et tidligere tidspunkt med endrede regler, aktører eller miljø, og sammenligne hvordan grenene utvikler seg.

Designbeslutninger og versjonsplan: [DESIGN.md](DESIGN.md).

## Kjøre lokalt

```sh
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # typesjekk + produksjonsbygg i dist/
```

## Bruk

- Mellomrom: spill/pause. Piltaster: ett steg frem/tilbake.
- Klikk på en aktør for å se genom, foreldre, søsken, barn og stamtre. Levende slektninger får en gul ring.
- «Forgrein herfra» åpner redigering av regler, populasjon, valgt aktør og miljø (pensel). «Start gren» lager en ny gren i historikken.
- Endring av en regel i Regler-fanen utenfor redigering lager en ny gren automatisk.
- Klikk i tidslinjen eller i en graf for å hoppe i tid.
- Eksporter lagrer hele historikken som `.json.gz`. Importer laster den inn igjen.

## Navn

Aktørene får norske fornavn (etter kjønn) og etternavn fra SSBs navnestatistikk, vektet etter hvor mange som har navnet: [tabell 10501](https://www.ssb.no/statbank/table/10501) (fornavn) og [tabell 12891](https://www.ssb.no/statbank/table/12891) (etternavn brukt av 200 eller flere). Dataene ligger i `src/sim/data/ssb-names.json` og oppdateres med `node scripts/fetch-names.mjs`. Lisens: CC BY 4.0.

## Versjoner

Hver versjon er en git-tag `vN` og står i `versions.json`. `node scripts/build-site.mjs` bygger alle tagger til `site/vN/`, main til `site/dev/` og en indeksside. GitHub Actions (`.github/workflows/pages.yml`) kjører skriptet og publiserer til GitHub Pages ved push til main og ved nye tagger.

Hver bygde versjon får en versjonsvelger nederst til venstre (`scripts/site/switcher.js`, lagt inn av byggeskriptet). Den lenker til de andre versjonene og viser endringene mellom to valgte versjoner, hentet fra `changes` i `versions.json`. `npm run site` bygger alt og starter en lokal forhåndsvisning på http://localhost:5180/.

`versions.json` har `versions` (frosne versjoner, hver med `changes` mot forrige versjon) og `dev` (endringer på main siden siste versjon). Før du legger til noe på main, før det opp i `dev.changes`.

For å fryse en ny versjon: øk `VERSION` i `src/version.ts`, flytt `dev.changes` inn i en ny oppføring i `versions` og tøm `dev.changes`, commit og tag `vN`.
