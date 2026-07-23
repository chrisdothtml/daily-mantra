import { randomUUID } from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { convosDir } from '../constants.ts';

/** standardized error thrown by all LLM providers */
export class LLMError extends Error {
  constructor(
    public title: string,
    public msg: string,
    public code?: string,
    /** id of the stored convo (see {@linkcode LLM.storeConvo}), if a chat exchange completed before the error occurred */
    public convoId?: string
  ) {
    super(msg);
    this.name = 'LLMError';
  }

  toJSON() {
    return {
      title: this.title,
      msg: this.msg,
      code: this.code,
      convoId: this.convoId,
    };
  }
}

/**
 * Coerce any thrown value into an {@linkcode LLMError}. If `convoId` is
 * provided and the error doesn't already carry one, it's attached so callers
 * can trace an error back to the stored chat exchange that produced it.
 */
export function toLLMError(error: unknown, convoId?: string): LLMError {
  if (error instanceof LLMError) {
    if (convoId && !error.convoId) error.convoId = convoId;
    return error;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return new LLMError('Unexpected error', msg, undefined, convoId);
}

function statusTitle(status: number): string {
  if (status === 401) return 'Auth failed';
  if (status === 403) return 'Access denied';
  if (status === 404) return 'Not found';
  if (status === 429) return 'Rate limited';
  if (status >= 500) return 'Server error';
  return 'Request failed';
}

/**
 * Provider-agnostic chat parameters. Every provider applies these where its
 * API supports them; they live here (rather than per-provider) so the
 * providers behave consistently.
 */
export interface ChatParams {
  /**
   * Sampling temperature. Defaults to 0 (deterministic) for reproducible
   * experiments. Note: OpenAI reasoning models (the "o" and "gpt-5" families)
   * reject an explicit temperature, so OpenAI omits it for those.
   */
  temperature: number;
  /**
   * Response token cap. The Anthropic API REQUIRES an explicit value, so it
   * must be defined here; the other providers' APIs default it when omitted
   * and don't need it sent (for OpenAI reasoning models a cap would even be
   * harmful: reasoning tokens count against it, risking truncated output).
   */
  maxTokens: number;
}

export abstract class LLM {
  static defaultParams: ChatParams = {
    temperature: 0,
    maxTokens: 4096,
  };

  static async clearConvos() {
    await fs.rm(convosDir, { force: true, recursive: true });
  }

  /** display name used in error messages */
  protected abstract readonly providerName: string;

  /** verifies the connection/credentials and that `model` is usable; throws {@linkcode LLMError} */
  abstract chat(model: string, messages: ChatMessage[]): Promise<ChatResponse>;

  /** extract a human-readable message (and optional error code) from the provider's error response body */
  protected abstract parseErrorBody(body: unknown): {
    msg?: string;
    code?: string;
  };

  /**
   * `fetch` wrapper that converts network failures and error responses into
   * {@linkcode LLMError}s (including provider error details when available)
   */
  protected async request(
    url: string,
    init: RequestInit = {}
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      const error = e as Error & { cause?: { code?: string } };
      // aborts aren't connection errors; let callers handle them
      if (error.name === 'AbortError') throw error;

      let host = url;
      try {
        host = new URL(url).origin;
      } catch {}
      throw new LLMError(
        'Connection failed',
        `Couldn't reach ${this.providerName} (${host})`,
        error.cause?.code ?? error.message
      );
    }

    if (!res.ok) {
      let parsed: { msg?: string; code?: string } = {};
      try {
        parsed = this.parseErrorBody(await res.json());
      } catch {}

      throw new LLMError(
        statusTitle(res.status),
        parsed.msg ??
          `${this.providerName} responded with "${res.status} ${res.statusText}"`,
        ['HTTP ' + res.status, parsed.code].filter(Boolean).join(' · ')
      );
    }

    return res;
  }

  /** persists a chat exchange to disk so past experiments/prompts can be revisited */
  protected async storeConvo(messages: ChatMessage[], response: any) {
    const convoId = Date.now() + '-' + randomUUID().split('-')[0];

    await fs.mkdir(convosDir, { recursive: true });
    await fs.writeFile(
      path.join(convosDir, `${convoId}.json`),
      JSON.stringify({ convoId, messages, response }, null, 2)
    );

    return convoId;
  }
}

export type ChatResponse = [response: any, convoId: string];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
