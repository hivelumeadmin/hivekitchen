import type { ToolSpec } from '../tools.manifest.js';

export interface LLMCallOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage: { promptTokens: number; completionTokens: number };
}

export interface LLMStreamEvent {
  type: 'delta' | 'tool_call_delta' | 'done';
  content?: string;
  toolCallDelta?: { id: string; name?: string; argumentsDelta?: string };
}

export interface LLMProvider {
  readonly name: string;
  complete(prompt: string, tools: ToolSpec[], options: LLMCallOptions): Promise<LLMResponse>;
  stream(prompt: string, tools: ToolSpec[], options: LLMCallOptions): AsyncIterable<LLMStreamEvent>;
  probe(): Promise<boolean>;
}
