// Anthropic Messages API provider. Works in the browser (the user's own key, sent directly with the SDK's
// browser mode, which adds the `anthropic-dangerous-direct-browser-access` header) and in Node (CLI).

import Anthropic from '@anthropic-ai/sdk';
import type { CompletionRequest, LLMProvider, ToolCallResult } from './provider';

export const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5'] as const;
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export type Effort = 'low' | 'medium' | 'high';

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  constructor(private opts: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      // The key belongs to the person using the page (pasted into the prompt panel); there is no backend.
      dangerouslyAllowBrowser: typeof window !== 'undefined',
    });
  }

  get model() { return this.opts.model ?? DEFAULT_MODEL; }

  async complete(req: CompletionRequest): Promise<ToolCallResult> {
    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: this.opts.maxTokens ?? 16000,
        // On a policy decline the API re-runs the turn on a fallback model it picks.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: this.opts.effort ?? 'medium' },
        // static system prompt + tool list are cached; the per-prompt world context lives in the user turn
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        tools: req.tools,
        messages: req.messages,
      }, { signal: req.signal });
    } catch (e) {
      throw new Error(describeError(e));
    }
    const u = msg.usage;
    return {
      content: msg.content as unknown as Anthropic.Beta.BetaContentBlockParam[],
      stopReason: msg.stop_reason,
      model: msg.model,
      usage: { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
      refusal: msg.stop_reason === 'refusal' ? (msg.stop_details?.explanation ?? 'the model declined this request') : undefined,
    };
  }
}

function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Anthropic API: the API key was rejected (401). Check the key in the prompt panel settings.';
  if (e instanceof Anthropic.PermissionDeniedError) return `Anthropic API: permission denied (403): ${e.message}`;
  if (e instanceof Anthropic.NotFoundError) return `Anthropic API: not found (404), possibly an unknown model id: ${e.message}`;
  if (e instanceof Anthropic.RateLimitError) return 'Anthropic API: rate limited (429). Wait a moment and try again.';
  if (e instanceof Anthropic.BadRequestError) return `Anthropic API: bad request (400): ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return `Anthropic API: could not connect: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status ?? ''}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
