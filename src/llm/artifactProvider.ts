// Stub for hosting as a claude.ai artifact, where the page can call Claude without an API key.
import type { CompletionRequest, LLMProvider, ToolCallResult } from './provider';

export class ArtifactSampleProvider implements LLMProvider {
  readonly name = 'artifact';
  // TODO: when hosted as an artifact, route `req` through the artifact runtime's Claude call
  // (it supports tool use), map its response onto ToolCallResult, and drop the API key UI.
  async complete(_req: CompletionRequest): Promise<ToolCallResult> {
    throw new Error('ArtifactSampleProvider is not implemented yet');
  }
}
