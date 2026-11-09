// Downloads Norwegian first names (by sex) and surnames from Statistics Norway (SSB) and writes
// src/sim/data/ssb-names.json. Run manually: node scripts/fetch-names.mjs
// Source: SSB Statbank tables 10501 (girls' and boys' names) and 12891 (surnames used by 200+),
// licensed under CC BY 4.0.
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = 'https://data.ssb.no/api/v0/no/table';
const out = join(resolve(import.meta.dirname, '..'), 'src/sim/data/ssb-names.json');

const fetchLatest = async (table, variable) => {
  const res = await fetch(`${API}/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: [{ code: 'Tid', selection: { filter: 'top', values: ['1'] } }],
      response: { format: 'json-stat2' },
    }),
  });
  if (!res.ok) throw new Error(`SSB ${table}: HTTP ${res.status}`);
  const d = await res.json();
  const { index, label } = d.dimension[variable].category;
  const year = Object.keys(d.dimension.Tid.category.index)[0];
  const rows = Object.entries(index)
    .map(([code, i]) => ({ code, name: label[code], count: d.value[i] }))
    .filter((r) => typeof r.count === 'number' && r.count > 0)
    .sort((a, b) => b.count - a.count);
  return { year, rows };
};

const first = await fetchLatest(10501, 'Fornavn');
const last = await fetchLatest(12891, 'Etternavn');

// Codes in 10501 start with 1 (girls' names) or 2 (boys' names).
const pairs = (rows) => rows.map((r) => [r.name, r.count]);
const data = {
  source: {
    publisher: 'Statistisk sentralbyrå (SSB)',
    license: 'CC BY 4.0',
    firstNames: { table: '10501', year: first.year, url: 'https://www.ssb.no/statbank/table/10501' },
    surnames: { table: '12891', year: last.year, url: 'https://www.ssb.no/statbank/table/12891' },
  },
  female: pairs(first.rows.filter((r) => r.code.startsWith('1'))),
  male: pairs(first.rows.filter((r) => r.code.startsWith('2'))),
  surnames: pairs(last.rows),
};
writeFileSync(out, JSON.stringify(data));
console.log(
  `Wrote ${out}: ${data.female.length} female, ${data.male.length} male first names (${first.year}), ` +
    `${data.surnames.length} surnames (${last.year})`,
);
