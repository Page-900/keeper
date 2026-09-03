import { fileURLToPath } from 'node:url';

import { readDocument } from '../keeper/material.js';
import { STAGES, type StageName } from '../shared/progress.js';

export const CHECK_DOCUMENT_FILE = fileURLToPath(
  new URL('../../material/deploy-check.md', import.meta.url),
);

export interface CheckRow {
  name: string;
  passed: boolean;
  detail: string;
}

export interface DeployCheck {
  url: string;
  rows: CheckRow[];
  passed: boolean;
}

export interface CheckRun {
  fetcher?: typeof fetch;
  say?: string;
  seconds?: number;
}

export const CHECK_DEADLINE_SECONDS = 240;

type Fields = Record<string, unknown>;

const fieldsOf = (value: unknown): Fields =>
  typeof value === 'object' && value !== null ? (value as Fields) : {};

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const stringOf = (value: unknown): string => (typeof value === 'string' ? value : '');

const at = (base: string, path: string): string =>
  new URL(path, base.endsWith('/') ? base : `${base}/`).toString();

/** A half written line is a failed check, never a crash, so the row can say what arrived. */
const linesIn = (text: string): Fields[] => {
  const found: Fields[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      found.push(fieldsOf(JSON.parse(line)));
    } catch {
      return found;
    }
  }
  return found;
};

const row = (name: string, passed: boolean, detail: string): CheckRow => ({ name, passed, detail });

const reached = (lines: Fields[]): StageName[] =>
  lines.map((line) => stringOf(line['stage'])).filter((name): name is StageName => name !== '');

const errorIn = (lines: Fields[]): string | null => {
  const failed = lines.find((line) => line['error'] !== undefined);
  return failed === undefined ? null : stringOf(fieldsOf(failed['error'])['says']);
};

const recordIn = (lines: Fields[]): Fields | null => {
  const last = lines.findLast((line) => line['attempt'] !== undefined);
  return last === undefined ? null : fieldsOf(last['attempt']);
};

const pageRow = async (answer: Response): Promise<CheckRow> => {
  const html = await answer.text();
  return row(
    'The page is served',
    answer.ok && html.length > 0,
    `${String(answer.status)}, ${String(html.length)} bytes`,
  );
};

const stateRow = (answer: Response, body: unknown): CheckRow => {
  const state = fieldsOf(body);
  const block = stringOf(state['blockNumber']);
  const holders = listOf(state['holders']).length;
  return row(
    'It reads the chain',
    answer.ok && block !== '' && holders > 0,
    answer.ok
      ? `block ${block === '' ? 'missing' : block}, ${String(holders)} holders, attack box ${state['attackBoxOn'] === true ? 'on' : 'OFF'}`
      : `the page answered ${String(answer.status)}`,
  );
};

const layersRow = (record: Fields): CheckRow => {
  const layers = fieldsOf(record['layers']);
  const block = stringOf(layers['blockNumber']);
  const asked = listOf(layers['answers']).length;
  if (stringOf(record['verdict']) === '')
    return row('The layers answer', true, 'the turn proposed nothing, so no layer was asked');
  return row(
    'The layers answer',
    block !== '' && asked > 0,
    block === ''
      ? 'a proposal was made and no layer was asked'
      : `${String(asked)} layers at block ${block}`,
  );
};

const dryRunRow = (record: Fields): CheckRow => {
  if (stringOf(record['verdict']) === '')
    return row(
      'The chain was asked',
      true,
      'the turn proposed nothing, so there was nothing to ask',
    );
  const layers = fieldsOf(record['layers']);
  const run = fieldsOf(layers['dryRun']);
  const block = stringOf(run['atBlock']);
  if (block === '')
    return row('The chain was asked', false, 'the delivery was never put to the chain');
  const guarded = stringOf(layers['blockNumber']);
  return row(
    'The chain was asked',
    block === guarded,
    block === guarded
      ? `the ${stringOf(run['layer'])} layer answered at block ${block}`
      : `answered at block ${block}, which is not the ${guarded} the guard read`,
  );
};

const said = (record: Fields, stages: StageName[]): string => {
  const verdict = stringOf(record['verdict']);
  return `${String(stages.length)} of ${String(STAGES.length)} stages, ${verdict === '' ? 'nothing proposed' : `verdict ${verdict}`}`;
};

/** A record only reaches the stream when the whole turn ran, so its absence is the failure. */
const turnRows = (lines: Fields[]): CheckRow[] => {
  const stages = reached(lines);
  const failed = errorIn(lines);
  const record = recordIn(lines);
  if (record === null)
    return [
      row(
        'A turn completes',
        false,
        failed ?? `it stopped after ${String(stages.length)} of ${String(STAGES.length)} stages`,
      ),
      row('The layers answer', false, 'the turn never finished'),
      row('The chain was asked', false, 'the turn never finished'),
    ];
  return [
    row('A turn completes', true, said(record, stages)),
    layersRow(record),
    dryRunRow(record),
  ];
};

const refusedRows = (answer: Response, body: unknown): CheckRow[] => [
  row(
    'A turn completes',
    false,
    `the page refused it: ${stringOf(fieldsOf(body)['says'])} (${String(answer.status)})`,
  ),
  row('The layers answer', false, 'the turn never ran'),
  row('The chain was asked', false, 'the turn never ran'),
];

/** This asks the deployed page to think once. It spends one model call and enforces nothing. */
export async function checkDeployed(url: string, run: CheckRun = {}): Promise<DeployCheck> {
  const {
    fetcher = fetch,
    say = readDocument(CHECK_DOCUMENT_FILE),
    seconds = CHECK_DEADLINE_SECONDS,
  } = run;
  const signal = AbortSignal.timeout(seconds * 1000);

  const page = await fetcher(url, { signal });
  const state = await fetcher(at(url, 'api/state'), { signal });
  const read: unknown = state.ok ? await state.json() : null;

  const turn = await fetcher(at(url, 'api/attempt'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ say }),
    signal,
  });
  const text = await turn.text();

  const rows = [
    await pageRow(page),
    stateRow(state, read),
    ...(turn.ok ? turnRows(linesIn(text)) : refusedRows(turn, linesIn(text)[0] ?? {})),
  ];
  return { url, rows, passed: rows.every((each) => each.passed) };
}
