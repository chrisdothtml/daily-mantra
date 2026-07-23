import { LLM, type ChatMessage, type ChatResponse } from './_LLM.ts';

export class OpenAI extends LLM {
  protected readonly providerName = 'OpenAI';

  private baseUrl = 'https://api.openai.com/v1';
  private headers: Record<string, string>;

  constructor(
    apiKey: string,
    private signal: AbortSignal | null = null
  ) {
    super();
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  protected parseErrorBody(body: unknown) {
    const { error } = (body ?? {}) as {
      error?: { message?: string; type?: string; code?: string };
    };
    return { msg: error?.message, code: error?.code ?? error?.type };
  }

  async chat(model: string, messages: ChatMessage[]): Promise<ChatResponse> {
    const body: Record<string, unknown> = { model, messages };
    // reasoning models (o*/gpt-5*) reject any temperature but their default
    if (!/^(o\d|gpt-5)/.test(model)) {
      body.temperature = LLM.defaultParams.temperature;
    }

    const response = await this.request(`${this.baseUrl}/chat/completions`, {
      signal: this.signal,
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    this.signal?.throwIfAborted();

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };
    const convoId = await this.storeConvo(messages, data);

    return [data.choices[0].message.content, convoId];
  }
}
