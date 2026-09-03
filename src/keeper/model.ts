import { setTimeout as after } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { KeeperError } from '../shared/errors.js';
import { appendRecord } from '../shared/jsonl.js';
import { readSecret, scrubError } from '../shared/secrets.js';
import type { ToolSpec } from './intent.js';

export const MODEL = 'openai/gpt-oss-120b';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export const MODEL_KEY_VARIABLE = 'GROQ_API_KEY';

const MAX_OUTPUT_TOKENS = 16_000;

const REASONING_EFFORT = 'high';

export const MODEL_CALL_FILE = fileURLToPath(
  new URL('../../evidence/model-calls.jsonl', import.meta.url),
);

export interface ModelRequest {
  system: string;
  user: string;
  tools: ToolSpec[];
}

export interface ModelReply {
  status: string;
  refusal: string | null;
  reasoning: string;
  toolCalls: { name: string; input: unknown }[];
  text: string;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
}

export interface ModelCall extends ModelReply {
  at: string;
  model: string;
  systemBytes: number;
  userBytes: number;
}

type Fields = Record<string, unknown>;

const fieldsOf = (value: unknown): Fields =>
  typeof value === 'object' && value !== null ? (value as Fields) : {};

const listOf = (value: unknown): Fields[] =>
  Array.isArray(value) ? value.map((entry) => fieldsOf(entry)) : [];

const stringOf = (value: unknown): string => (typeof value === 'string' ? value : '');

const countOf = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** Arguments arrive as text, and text that is not JSON is handed on for the reader to refuse. */
const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const choiceOf = (answer: Fields): Fields => fieldsOf(listOf(answer['choices'])[0]);

const callsIn = (message: Fields): { name: string; input: unknown }[] =>
  listOf(message['tool_calls']).map((call) => {
    const called = fieldsOf(call['function']);
    return { name: stringOf(called['name']), input: parsed(stringOf(called['arguments'])) };
  });

const FILTERED = 'content_filter';

/** A model that declines is a real result of an attack run, so it is read out, never dropped. */
function refusalIn(choice: Fields, message: Fields): string | null {
  const said = stringOf(message['refusal']);
  if (said !== '') return said;
  return stringOf(choice['finish_reason']) === FILTERED ? 'the vendor filtered the answer' : null;
}

function readReply(answer: unknown): ModelReply {
  const fields = fieldsOf(answer);
  const choice = choiceOf(fields);
  const message = fieldsOf(choice['message']);
  const usage = fieldsOf(fields['usage']);
  return {
    status: stringOf(choice['finish_reason']),
    refusal: refusalIn(choice, message),
    reasoning: stringOf(message['reasoning']).trim(),
    toolCalls: callsIn(message),
    text: stringOf(message['content']),
    inputTokens: countOf(usage['prompt_tokens']),
    outputTokens: countOf(usage['completion_tokens']),
    thoughtTokens: countOf(fieldsOf(usage['completion_tokens_details'])['reasoning_tokens']),
  };
}

export const TOO_MANY_REQUESTS = 429;

const MAX_COMPLAINT = 200;

const complaintIn = (body: unknown): string => {
  const named = stringOf(fieldsOf(fieldsOf(body)['error'])['message']);
  return named === '' ? stringOf(body).slice(0, MAX_COMPLAINT) : named;
};

/** fetch answers a refusal instead of throwing it, so the status is named here or nowhere. */
function refused(status: number, body: unknown): KeeperError {
  const said = complaintIn(body);
  const kind = status === TOO_MANY_REQUESTS ? 'modelBusy' : 'modelUnreachable';
  return new KeeperError(kind, said === '' ? `the vendor answered ${String(status)}` : said);
}

export type Asker = (request: ModelRequest) => Promise<unknown>;

const asFunction = (tool: ToolSpec): unknown => ({
  type: tool.type,
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
});

/** tool_choice stays auto: forcing a call would hide the model declining, which is a result. */
const asked = (request: ModelRequest): string =>
  JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
    tools: request.tools.map(asFunction),
    tool_choice: 'auto',
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    reasoning_effort: REASONING_EFFORT,
  });

export const ask: Asker = async (request) => {
  const answer = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${readSecret(MODEL_KEY_VARIABLE)}`,
      'content-type': 'application/json',
    },
    body: asked(request),
  });
  const said = parsed(await answer.text());
  if (!answer.ok) throw refused(answer.status, said);
  return said;
};

export interface AskRun {
  asker?: Asker;
  file?: string;
  seconds?: number;
}

export const MODEL_DEADLINE_SECONDS = 180;

const LATE = Symbol('no answer in time');

/** A public page must never hang on a vendor, so the wait has an end the visitor can be told. */
async function inTime<T>(work: Promise<T>, seconds: number): Promise<T> {
  work.catch(() => undefined);
  const first = await Promise.race([work, after(seconds * 1000, LATE, { ref: false })]);
  if (first === LATE)
    throw new KeeperError('modelUnreachable', `it gave no answer in ${String(seconds)} seconds`);
  return first;
}

export async function askModel(
  request: ModelRequest,
  { asker = ask, file = MODEL_CALL_FILE, seconds = MODEL_DEADLINE_SECONDS }: AskRun = {},
): Promise<ModelReply> {
  let answer: unknown;
  try {
    answer = await inTime(Promise.resolve(asker(request)), seconds);
  } catch (cause) {
    if (cause instanceof KeeperError) throw cause;
    throw new KeeperError('modelUnreachable', scrubError(cause).message);
  }

  const reply = readReply(answer);
  const call: ModelCall = {
    at: new Date().toISOString(),
    model: MODEL,
    systemBytes: request.system.length,
    userBytes: request.user.length,
    ...reply,
  };
  appendRecord(file, call);
  return reply;
}
