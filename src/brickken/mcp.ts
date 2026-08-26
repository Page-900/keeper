import { BRICKKEN_MCP_URL } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { readSecret } from '../shared/secrets.js';
import { API_KEY_VARIABLE } from './client.js';
import { EVIDENCE_FILE, recorded } from './log.js';

const MCP_PATH = '/mcp';
const PROTOCOL_VERSION = '2025-06-18';
const SESSION_HEADER = 'mcp-session-id';
const TIMEOUT_MS = 30_000;
const CLIENT = { name: 'keeper', version: '0.1.0' };

const asRecord = (value: unknown): Record<string, unknown> =>
  (value ?? {}) as Record<string, unknown>;

/** Streamable HTTP may answer one request as JSON or as an event stream, so both are read. */
function messages(body: string, contentType: string): unknown[] {
  if (!contentType.includes('text/event-stream')) return [JSON.parse(body) as unknown];
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice('data:'.length).trim()) as unknown);
}

/** An answer is matched on its answer fields too, because a server may send our own id back. */
function resultOf(found: unknown[], id: number, method: string): unknown {
  const reply = found.find((message) => {
    const carried = asRecord(message);
    return carried['id'] === id && ('result' in carried || 'error' in carried);
  });
  if (reply === undefined)
    throw new KeeperError('brickkenUnreadable', `${method} was answered without a reply to it`);
  const error = asRecord(asRecord(reply)['error']);
  if (Object.keys(error).length > 0)
    throw new KeeperError('brickkenRejected', `${method}: ${String(error['message'])}`);
  return asRecord(reply)['result'];
}

function spokenText(result: Record<string, unknown>): string | undefined {
  const content = result['content'];
  const first = Array.isArray(content) ? (content[0] as unknown) : undefined;
  const spoken = asRecord(first)['text'];
  if (typeof spoken === 'string') return spoken;
  const structured = result['structuredContent'];
  return structured === undefined ? undefined : JSON.stringify(structured);
}

/** An answer we cannot read is never returned as an empty one: that would log as a success. */
function contentOf(result: unknown, tool: string): string {
  const found = asRecord(result);
  const text = spokenText(found);
  if (found['isError'] === true)
    throw new KeeperError('brickkenRejected', `${tool}: ${text ?? 'refused with no reason given'}`);
  if (text === undefined)
    throw new KeeperError('brickkenUnreadable', `${tool} answered with nothing readable`);
  return text;
}

interface Wire {
  send: typeof fetch;
  url: string;
  session: { id?: string };
}

/** Encoded before the attempt, so our own bad argument is never reported as their outage. */
async function request(wire: Wire, payload: object, method: string): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL_VERSION,
  };
  if (wire.session.id !== undefined) headers[SESSION_HEADER] = wire.session.id;

  let response: Response;
  try {
    response = await wire.send(wire.url, {
      method: 'POST',
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new KeeperError('brickkenUnreachable', `${method}: ${String(cause)}`);
  }
  const issued = response.headers.get(SESSION_HEADER);
  if (issued !== null) wire.session.id = issued;
  if (response.status === 429) throw new KeeperError('brickkenRateLimited', `${method} over MCP`);
  if (!response.ok)
    throw new KeeperError('brickkenRejected', `${method} returned HTTP ${String(response.status)}`);
  return response;
}

async function post(
  wire: Wire,
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const response = await request(wire, { jsonrpc: '2.0', id, method, params }, method);
  const body = await response.text();
  try {
    return resultOf(messages(body, response.headers.get('content-type') ?? ''), id, method);
  } catch (cause) {
    if (cause instanceof KeeperError) throw cause;
    throw new KeeperError('brickkenUnreadable', `${method} returned a body that is not JSON-RPC`);
  }
}

function toolNames(result: unknown): string[] {
  const tools = asRecord(result)['tools'];
  if (!Array.isArray(tools))
    throw new KeeperError('brickkenUnreadable', 'tools/list answered with no tool list');
  return tools.map((tool) => String(asRecord(tool)['name']));
}

export interface McpClient {
  listTools(): Promise<string[]>;
  call(tool: string, args: Record<string, unknown>): Promise<string>;
}

export interface McpRun {
  file?: string;
  url?: string;
  fetch?: typeof fetch;
}

export function createMcpClient(run: McpRun = {}): McpClient {
  const { file = EVIDENCE_FILE, url = BRICKKEN_MCP_URL, fetch: send = fetch } = run;
  const wire: Wire = { send, url, session: {} };
  let ready: Promise<void> | undefined;
  let counter = 0;

  const record = <T>(logged: string, run: () => Promise<T>): Promise<T> =>
    recorded(file, { surface: 'mcp', method: logged, path: MCP_PATH }, run);

  const ask = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    post(wire, (counter += 1), method, params);

  /** Read inside the record, never after it: an unusable answer must land as a failure. */
  const callTool = (tool: string, args: Record<string, unknown>): Promise<string> =>
    record(tool, async () =>
      contentOf(await ask('tools/call', { name: tool, arguments: args }), tool),
    );

  /** The key travels as a tool argument, so it is read here and never put in a record. */
  const open = async (): Promise<void> => {
    const hello = { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT };
    await record('initialize', () => ask('initialize', hello));
    await record('notifications/initialized', async () => {
      await request(wire, { jsonrpc: '2.0', method: 'notifications/initialized' }, 'initialized');
    });
    await callTool('configure', { env: 'sandbox', apiKey: readSecret(API_KEY_VARIABLE) });
  };

  const opened = (): Promise<void> => (ready ??= open());

  return {
    async listTools() {
      await opened();
      return record('tools/list', async () => toolNames(await ask('tools/list', {})));
    },
    async call(tool, args) {
      await opened();
      return callTool(tool, args);
    },
  };
}
