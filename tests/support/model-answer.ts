export interface Called {
  name: string;
  input?: unknown;
  raw?: string;
}

export interface Answered {
  reasoning?: string;
  content?: string;
  refusal?: string;
  calls?: Called[];
  finish?: string;
}

const toolCall = (call: Called, at: number): unknown => ({
  id: `fc_${String(at)}`,
  type: 'function',
  function: { name: call.name, arguments: call.raw ?? JSON.stringify(call.input) },
});

const messageOf = (answered: Answered, calls: Called[]): unknown => ({
  role: 'assistant',
  reasoning: answered.reasoning ?? 'weighing it',
  ...(answered.content === undefined ? {} : { content: answered.content }),
  ...(answered.refusal === undefined ? {} : { refusal: answered.refusal }),
  ...(calls.length === 0 ? {} : { tool_calls: calls.map(toolCall) }),
});

/** The shape a live Groq answer had on 2026-09-02, so a stub cannot drift from the vendor. */
export function modelAnswer(answered: Answered = {}): unknown {
  const calls = answered.calls ?? [];
  return {
    id: 'chatcmpl-56efad51',
    object: 'chat.completion',
    model: 'openai/gpt-oss-120b',
    choices: [
      {
        index: 0,
        message: messageOf(answered, calls),
        finish_reason: answered.finish ?? (calls.length === 0 ? 'stop' : 'tool_calls'),
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      completion_tokens_details: { reasoning_tokens: 5 },
    },
  };
}
