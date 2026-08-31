import { fileURLToPath } from 'node:url';

import { GoogleGenAI } from '@google/genai';

import { KeeperError } from '../shared/errors.js';
import { appendRecord } from '../shared/jsonl.js';
import { readSecret, scrubError } from '../shared/secrets.js';
import type { ToolSpec } from './intent.js';

export const MODEL = 'gemini-3.6-flash';

const MAX_OUTPUT_TOKENS = 16_000;

const THINKING_LEVEL = 'high';

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

const client = (): GoogleGenAI => new GoogleGenAI({ apiKey: readSecret('GEMINI_API_KEY') });

type Fields = Record<string, unknown>;

const fieldsOf = (value: unknown): Fields =>
  typeof value === 'object' && value !== null ? (value as Fields) : {};

const listOf = (value: unknown): Fields[] =>
  Array.isArray(value) ? value.map((entry) => fieldsOf(entry)) : [];

const stringOf = (value: unknown): string => (typeof value === 'string' ? value : '');

const countOf = (value: unknown): number => (typeof value === 'number' ? value : 0);

const stepsTyped = (answer: Fields, type: string): Fields[] =>
  listOf(answer['steps']).filter((step) => step['type'] === type);

const summaryText = (step: Fields): string =>
  listOf(step['summary'])
    .map((part) => stringOf(part['text']))
    .join('\n');

const errorText = (value: unknown): string => {
  const error = fieldsOf(value);
  const message = stringOf(error['message']);
  return message === '' ? '' : message;
};

/** A model that declines is a real result of an attack run, so it is read out, never dropped. */
function refusalIn(answer: Fields): string | null {
  const fromStep = stepsTyped(answer, 'model_output')
    .map((step) => errorText(step['error']))
    .find((message) => message !== '');
  const fromInteraction = listOf(answer['errors'])
    .map((error) => errorText(error))
    .find((message) => message !== '');
  return fromStep ?? fromInteraction ?? null;
}

export function readReply(answer: unknown): ModelReply {
  const fields = fieldsOf(answer);
  const usage = fieldsOf(fields['usage']);
  return {
    status: stringOf(fields['status']),
    refusal: refusalIn(fields),
    reasoning: stepsTyped(fields, 'thought')
      .map((step) => summaryText(step))
      .join('\n')
      .trim(),
    toolCalls: stepsTyped(fields, 'function_call').map((step) => ({
      name: stringOf(step['name']),
      input: step['arguments'],
    })),
    text: stringOf(fields['output_text']),
    inputTokens: countOf(usage['total_input_tokens']),
    outputTokens: countOf(usage['total_output_tokens']),
    thoughtTokens: countOf(usage['total_thought_tokens']),
  };
}

export type Asker = (request: ModelRequest) => Promise<unknown>;

/** tool_choice stays auto: forcing a call would hide the model declining, which is a result. */
const ask: Asker = (request) =>
  client().interactions.create({
    model: MODEL,
    system_instruction: request.system,
    input: request.user,
    tools: request.tools,
    generation_config: {
      max_output_tokens: MAX_OUTPUT_TOKENS,
      thinking_level: THINKING_LEVEL,
      thinking_summaries: 'auto',
      tool_choice: 'auto',
    },
  });

export interface AskRun {
  asker?: Asker;
  file?: string;
}

export async function askModel(
  request: ModelRequest,
  { asker = ask, file = MODEL_CALL_FILE }: AskRun = {},
): Promise<ModelReply> {
  let answer: unknown;
  try {
    answer = await asker(request);
  } catch (cause) {
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
