// Turns coverage/coverage-summary.json (vitest's json-summary reporter) into a Markdown table.
// CI appends it to the job summary: node scripts/coverage-summary.mjs >> "$GITHUB_STEP_SUMMARY"
import fs from 'node:fs';
import path from 'node:path';

const METRICS = ['statements', 'branches', 'functions', 'lines'];

const summary = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf8'));
const cells = (entry) => METRICS.map((metric) => `${entry[metric].pct}%`).join(' | ');
const rows = Object.entries(summary)
  .filter(([file]) => file !== 'total')
  .map(([file, entry]) => `| \`${path.relative(process.cwd(), file).replaceAll('\\', '/')}\` | ${cells(entry)} |`)
  .sort();

console.log(
  [
    '## Coverage',
    '',
    '| File | Statements | Branches | Functions | Lines |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    `| **All files** | ${METRICS.map((metric) => `**${summary.total[metric].pct}%**`).join(' | ')} |`,
    '',
  ].join('\n'),
);
