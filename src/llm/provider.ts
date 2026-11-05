// Provider adapter (BRIEF §5): one model turn in, one model turn out. The prompt runner owns the tool loop.

import type Anthropic from '@anthropic-ai/sdk';

export interface CompletionRequest {
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  messages: Anthropic.Beta.BetaMessageParam[];
  signal?: AbortSignal;
}

export interface ToolCallResult {
  /** the assistant turn, appended to the conversation unchanged */
  content: Anthropic.Beta.BetaContentBlockParam[];
  stopReason: string | null;
  /** model that actually answered (can differ after a refusal fallback) */
  model?: string;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** set on stop_reason "refusal" */
  refusal?: string;
}

export interface LLMProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<ToolCallResult>;
}
