import { NotImplementedError } from '../../common/errors.js';
import type {
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
} from './llm-provider.interface.js';

export class AnthropicAdapter implements LLMProvider {
  readonly name = 'anthropic';

  complete(): Promise<LLMResponse> {
    throw new NotImplementedError('AnthropicAdapter.complete');
  }

  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<LLMStreamEvent> {
    throw new NotImplementedError('AnthropicAdapter.stream');
  }

  probe(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
