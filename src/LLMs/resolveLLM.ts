import { LLM } from './_LLM.ts';
import { Anthropic } from './Anthropic.ts';
import { Ollama } from './Ollama.ts';
import { OpenAI } from './OpenAI.ts';

export const modelProviders = ['anthropic', 'ollama', 'openai'] as const;
export type ModelProvider = (typeof modelProviders)[number];

export interface LLMConfig {
  modelProvider: ModelProvider;
  /** required for `anthropic`/`openai` */
  apiKey?: string;
  /** `ollama` only; defaults to Ollama.defaultHost */
  baseUrl?: string;
}

/** Returns new instance of LLM based on provided {@linkcode LLMConfig} */
export function resolveLLM(
  config: LLMConfig,
  signal: AbortSignal | null = null
): LLM {
  const { modelProvider, apiKey, baseUrl } = config;

  switch (modelProvider) {
    case 'anthropic':
    case 'openai': {
      if (!apiKey) {
        throw new Error(`Missing ${modelProvider} API key`);
      }

      switch (modelProvider) {
        case 'anthropic':
          return new Anthropic(apiKey, signal);
        case 'openai':
          return new OpenAI(apiKey, signal);
      }
    }
    case 'ollama':
      return new Ollama(baseUrl, signal);
  }
}
