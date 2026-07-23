import { LLM, type ChatMessage, type ChatResponse } from './_LLM.ts';

export class Anthropic extends LLM {
  protected readonly providerName = 'Anthropic';

  private baseUrl = 'https://api.anthropic.com/v1';
  private headers: Record<string, string>;

  constructor(
    apiKey: string,
    private signal: AbortSignal | null = null
  ) {
    super();
    this.headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  protected parseErrorBody(body: unknown) {
    const { error } = (body ?? {}) as {
      error?: { type?: string; message?: string };
    };
    return { msg: error?.message, code: error?.type };
  }

  async chat(model: string, messages: ChatMessage[]): Promise<ChatResponse> {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      model,
      // the messages API requires an explicit max_tokens (see ChatParams)
      max_tokens: LLM.defaultParams.maxTokens,
      temperature: LLM.defaultParams.temperature,
      messages: nonSystemMessages,
    };
    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content).join('\n\n');
    }

    const response = await this.request(`${this.baseUrl}/messages`, {
      signal: this.signal,
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    this.signal?.throwIfAborted();

    const data = (await response.json()) as {
      content: { type: string; text: string }[];
    };
    const convoId = await this.storeConvo(messages, data);
    const message = data.content.find((b) => b.type === 'text')?.text ?? '';

    return [message, convoId];
  }
}
