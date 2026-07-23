import { LLM, type ChatMessage, type ChatResponse } from './_LLM.ts';

export interface OllamaParams {
  // Sampling
  temperature?: number; // randomness (0 = deterministic)
  top_k?: number; // limit vocab to top K tokens
  top_p?: number; // nucleus sampling
  min_p?: number; // minimum probability cutoff
  typical_p?: number; // typical sampling
  repeat_penalty?: number;
  repeat_last_n?: number;
  presence_penalty?: number;
  frequency_penalty?: number;

  // Generation limits
  num_predict?: number; // max tokens to generate
  stop?: string[]; // stop sequences

  // Performance / threading
  num_ctx?: number; // context window size
  num_batch?: number;
  num_thread?: number;

  // GPU / hardware
  num_gpu?: number;
  main_gpu?: number;
  low_vram?: boolean;
  f16_kv?: boolean;
  logits_all?: boolean;
  vocab_only?: boolean;
  use_mmap?: boolean;
  use_mlock?: boolean;

  // Misc
  seed?: number; // deterministic runs
  mirostat?: number; // 0=off, 1=mirostat, 2=mirostat v2
  mirostat_tau?: number;
  mirostat_eta?: number;
  penalize_newline?: boolean;

  // Advanced / model-specific
  grammar?: string; // BNF grammar constraint
}

export interface OllamaChatOptions {
  model: string;
  messages: ChatMessage[];
  format?: 'boolean' | 'json';
  stream?: boolean;
  options?: OllamaParams;
}

export class Ollama extends LLM {
  protected readonly providerName = 'Ollama';

  static defaultHost = 'http://localhost:11434';
  /** built-in recommended settings for models */
  static modelPresets: { [model: string]: OllamaParams } = {
    base: { temperature: LLM.defaultParams.temperature, num_ctx: 2e4 },
  } as const;

  constructor(
    private host: string = Ollama.defaultHost,
    private signal: AbortSignal | null = null
  ) {
    super();
  }

  protected parseErrorBody(body: unknown) {
    const { error } = (body ?? {}) as { error?: string };
    return { msg: typeof error === 'string' ? error : undefined };
  }

  async chat(model: string, messages: ChatMessage[]): Promise<ChatResponse> {
    const presetParams = Ollama.modelPresets[model] ?? {};
    const body: OllamaChatOptions = {
      stream: false,
      model,
      messages,
      options: { ...Ollama.modelPresets.base, ...presetParams },
    };

    const response = await this.request(`${this.host}/api/chat`, {
      signal: this.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    this.signal?.throwIfAborted();

    const data = (await response.json()) as { message: { content: string } };
    const convoId = await this.storeConvo(messages, data);

    return [data.message.content, convoId];
  }
}
