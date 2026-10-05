import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = resolve(repositoryRoot, 'docs/evidence/nemexia-target-priority-corpus');
const defaultTransitions = resolve(repositoryRoot, 'docs/evidence/nemexia-target-transitions.csv');
const sourceFilePattern = /^battles-\d{4}-\d{2}-\d{2}\.jsonl$/i;
const portableTransitionColumns = [
  'transition_id',
  'archive_part',
  'source_line',
  'run_id',
  'case_id',
  'experiment_block',
  'comparison_key',
  'replicate',
  'analysis_verified',
  'round',
  'action_side',
  'actor_class',
  'actor_count',
  'attacker_race',
  'defender_race',
  'previous_target',
  'previous_target_live_at_switch',
  'previous_target_order_in_report',
  'previous_target_killed_by_event_index',
  'current_target',
  'current_target_count_before_action',
  'current_target_order_in_report',
  'alive_targets_at_switch_json',
  'round_target_order_snapshot_json',
  'priority_order_plan_json',
  'actor_race_id',
  'actor_faction',
  'capture_status',
];

function parseArgs(args) {
  const options = { sourceDir: '', outputDir: defaultOutput, transitionsCsv: defaultTransitions, refreshExistingBundle: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--source-dir') options.sourceDir = resolve(args[++index] ?? '');
    else if (flag === '--output-dir') options.outputDir = resolve(args[++index] ?? '');
    else if (flag === '--transitions-csv') options.transitionsCsv = resolve(args[++index] ?? '');
    else if (flag === '--refresh-existing-bundle') options.refreshExistingBundle = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!options.sourceDir) throw new Error('Pass --source-dir <Nemexia simulation-battles folder>.');
  return options;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted && character === '"' && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('Transition CSV contains an unsupported multiline or unclosed quoted field.');
  cells.push(cell);
  return cells;
}

function quoteCsvCell(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function summarizeJsonl(path) {
  const content = await readFile(path, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  const counts = {
    rows: lines.length,
    withError: 0,
    analysisVerified: 0,
    cleanRows: 0,
    cleanVerifiedRows: 0,
    cleanOlderRows: 0,
    cleanReplayReadyRows: 0,
  };
  const rowsByLine = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    let row;
    try {
      row = JSON.parse(lines[index]);
    } catch (error) {
      throw new Error(`${basename(path)}:${index + 1}: invalid JSON (${error.message})`);
    }
    rowsByLine.set(index + 1, row);
    const hasError = typeof row.error === 'string' && row.error.trim() !== '';
    if (hasError) counts.withError += 1;
    if (row.analysis_verified === true) counts.analysisVerified += 1;
    if (!hasError) {
      counts.cleanRows += 1;
      if (row.analysis_verified === true) counts.cleanVerifiedRows += 1;
      else counts.cleanOlderRows += 1;
      if (Number.isInteger(row.rounds) && row.rounds > 0 && row.effective_form?.fields && row.planned_case) {
        counts.cleanReplayReadyRows += 1;
      }
    }
  }
  return { counts, bytes: Buffer.byteLength(content), sha256: sha256(Buffer.from(content)), rowsByLine };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputInfo = await stat(options.outputDir).catch(() => null);
  let priorSourceFileNames = null;
  if (outputInfo) {
    if (!options.refreshExistingBundle) throw new Error(`Output directory already exists; pass --refresh-existing-bundle to update this generated bundle: ${options.outputDir}`);
    if (!outputInfo.isDirectory()) throw new Error(`Output path exists but is not a directory: ${options.outputDir}`);
    const priorManifest = JSON.parse(await readFile(resolve(options.outputDir, 'manifest.json'), 'utf8'));
    if (priorManifest.schemaVersion !== 1 || !Array.isArray(priorManifest.sourceFileNames)) {
      throw new Error('Refusing to refresh an output directory without this bundle generator manifest.');
    }
    priorSourceFileNames = priorManifest.sourceFileNames;
  }

  const sourceNames = (await readdir(options.sourceDir)).filter((name) => sourceFilePattern.test(name)).sort();
  if (sourceNames.length !== 2) {
    throw new Error(`Expected exactly two battles-YYYY-MM-DD.jsonl files; found ${sourceNames.length}.`);
  }
  if (priorSourceFileNames && JSON.stringify(priorSourceFileNames) !== JSON.stringify(sourceNames)) {
    throw new Error('Refusing to refresh the bundle because the current source file names differ from its manifest.');
  }
  const transitionText = await readFile(options.transitionsCsv, 'utf8');
  const sourceLines = transitionText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line !== '');
  const sourceHeaders = parseCsvLine(sourceLines[0] ?? '');
  const requiredColumns = ['transition_id', 'jsonl_file', 'jsonl_line', 'run_id', 'case_id', ...portableTransitionColumns.slice(5)];
  const sourceIndexes = new Map(sourceHeaders.map((header, index) => [header, index]));
  const missingColumns = requiredColumns.filter((column) => !sourceIndexes.has(column));
  if (missingColumns.length) throw new Error(`Transition CSV is missing required columns: ${missingColumns.join(', ')}.`);

  const outputFiles = [];
  const sourceRowsByFile = new Map();
  await mkdir(options.outputDir, { recursive: true });
  for (const sourceName of sourceNames) {
    const sourcePath = resolve(options.sourceDir, sourceName);
    const destinationPath = resolve(options.outputDir, sourceName);
    await copyFile(sourcePath, destinationPath);
    const report = await summarizeJsonl(destinationPath);
    sourceRowsByFile.set(sourceName, report.rowsByLine);
    const { rowsByLine: _rowsByLine, ...publicReport } = report;
    outputFiles.push({ name: sourceName, ...publicReport });
  }

  const portableRows = [];
  for (let index = 1; index < sourceLines.length; index += 1) {
    const cells = parseCsvLine(sourceLines[index]);
    if (cells.length !== sourceHeaders.length) {
      throw new Error(`Transition CSV line ${index + 1} has ${cells.length} cells; expected ${sourceHeaders.length}.`);
    }
    const record = Object.fromEntries(sourceHeaders.map((header, columnIndex) => [header, cells[columnIndex]]));
    const archivePart = basename(record.jsonl_file);
    if (!sourceFilePattern.test(archivePart) || !/^\d+$/.test(record.jsonl_line)) {
      throw new Error(`Transition ${record.transition_id} has an unrecognized source locator.`);
    }
    const sourceRow = sourceRowsByFile.get(archivePart)?.get(Number(record.jsonl_line));
    if (!sourceRow || sourceRow.run_id !== record.run_id || sourceRow.case_id !== record.case_id) {
      throw new Error(`Transition ${record.transition_id} does not join to ${archivePart}:${record.jsonl_line}.`);
    }
    const portable = {
      transition_id: record.transition_id,
      archive_part: archivePart,
      source_line: record.jsonl_line,
    };
    for (const column of portableTransitionColumns.slice(3)) portable[column] = record[column];
    portableRows.push(portable);
  }

  const csv = [
    portableTransitionColumns.map(quoteCsvCell).join(','),
    ...portableRows.map((row) => portableTransitionColumns.map((column) => quoteCsvCell(row[column])).join(',')),
  ].join('\n') + '\n';
  const transitionsPath = resolve(options.outputDir, 'target-transitions.csv');
  await writeFile(transitionsPath, csv, 'utf8');
  const transitionsBuffer = Buffer.from(csv);
  const manifest = {
    schemaVersion: 1,
    sourceFileNames: sourceNames,
    battleFiles: outputFiles,
    targetTransitions: {
      rows: portableRows.length,
      verifiedSourceJoins: portableRows.length,
      bytes: transitionsBuffer.byteLength,
      sha256: sha256(transitionsBuffer),
    },
    exclusions: [
      'campaign-events JSONL, campaign manifests, HTML, MHTML, and screenshots are not copied by this script.',
      'The transition export omits local absolute paths, report URLs, and HTML line references; source locators use JSONL basenames and line numbers.',
    ],
  };
  await writeFile(resolve(options.outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
