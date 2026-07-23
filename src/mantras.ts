import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cacheDir } from './constants.ts';
import { fetchNotes } from './fetch-notes.ts';
import { LLM, toLLMError, type ChatMessage } from './LLMs/_LLM.ts';
import {
  modelProviders,
  resolveLLM,
  type ModelProvider,
} from './LLMs/resolveLLM.ts';
import {
  dedent,
  getEnv,
  getEnvStrict,
  getFileShasum,
  hashString,
  pathExists,
} from './utils.ts';

export class MantraManager {
  static mantraStorageFile = path.join(cacheDir, 'mantras.json');
  static notesCacheFile = path.join(cacheDir, 'notes.txt');
  static llmModels: Record<ModelProvider, string> = {
    anthropic: getEnv('ANTHROPIC_MODEL', 'claude-sonnet-4-5'),
    ollama: getEnv('OLLAMA_MODEL', 'gpt-oss:20b'),
    openai: getEnv('OPENAI_MODEL', 'gpt-5.4'),
  };
  static sysPrompt = dedent(`
    # Purpose
    Your job is to read the provided non-organized, train-of-thought-style notes provided, and generate a list of mantras from them, that will be used to provide users with a daily mantra from their own notes.

    The mantras will be presented to the user one at a time on a daily basis, so each mantra should be self-contained and un-reliant on the others.

    ## User input format
    You'll receive the user's raw notes as well as existing mantras that you have previously extracted. You should compare the latest \`rawNotes\` (which may or may not have changed since you last saw them) with the list of \`existingMantras\` and provide any new mantras that aren't already covered in the notes.

    User input will be a JSON object following this schema:
    \`\`\`typescript
    interface MantrasRequest {
      rawNotes: string;
      existingMantras: string[];
    }
    \`\`\`

    ## Output format
    Respond using ONLY this JSON schema; no other text:
    \`\`\`typescript
    interface MantrasResponse {
      // exactly one mantra per entry
      mantras: string[];
    }
    \`\`\`

    DO NOT wrap your output JSON in a code block (e.g. "\`\`\`json"), respond with raw JSON ONLY.

    ONLY respond with NEW mantras from the notes, that aren't already covered by the existing notes; if the notes are already covered by existing mantras, respond with an empty \`mantras\` array. Note that your goal isn't to infinitely generate mantras, so don't feel obligated to always provide new ones.

    ## Rules
    - Each mantra should be a single statement (max of two if applicable); keep it tight.
    - Some paraphrasing is allowed, but primarily defer to thoughts/ideas directly taken from the provided notes.
    - The user's notes/statements may not make sense or be very ambiguous. You can ignore these cases. Only generate mantras that can be generally understood out of context.
    - Phrase the mantras as if the user is speaking to themselves; speak in the second person ("You"/"Your").
    - Ensure your list of mantras (including the existing mantras) fully encasulates the entirety of the raw notes. Your response list should be deterministic and, when called with the same raw notes, should be the same (somewhat deterministic).
    - Avoid using words like "remember". The entire purpose of this list is to remind the user of insights from their own notes, and explicitly telling them to remember something is redundant.
  `);

  private llm: LLM;
  private model: string;

  constructor() {
    [this.llm, this.model] = this.resolveLLM();
  }

  /**
   * Refresh the notes/regenerate mantras if needed, and choose
   * a previously unchosen mantra from the list
   */
  public async getRandom() {
    let { mantras, usedMantras } = await this.updateMantras();

    const mantraHashes = Object.keys(mantras);
    // start with a set of all mantra hashes
    const mantraHashPoolSet = new Set(mantraHashes);
    // then remove any that exist in `usedMantras`
    for (const hash of usedMantras) {
      mantraHashPoolSet.delete(hash);
    }

    let mantraHashPool: string[];
    if (mantraHashPoolSet.size > 0) {
      // if some hashes still exist, pick one from the remaining
      mantraHashPool = Array.from(mantraHashPoolSet);
    } else {
      // if there's no more to choose from, clear out `usedMantras`
      // and start over
      usedMantras = [];
      mantraHashPool = mantraHashes;
    }

    const chosenHashIdx = crypto.randomInt(0, mantraHashPool.length);
    const chosenHash = mantraHashPool[chosenHashIdx];
    const chosenMantra = mantras[chosenHash];

    await this.saveStorage({
      mantras,
      usedMantras: usedMantras.concat(chosenHash),
    });
    return chosenMantra;
  }

  /** Clear the local cache files and start fresh */
  public async reset() {
    const { mantraStorageFile, notesCacheFile } = MantraManager;
    await Promise.all([
      fs.rm(mantraStorageFile, { recursive: true, force: true }),
      fs.rm(notesCacheFile, { recursive: true, force: true }),
    ]);
  }

  /**
   * 1. Refresh the notes
   * 2. If the notes mis-match what we had stored, query the LLM
   *    to possibly generate new mantras
   * 3. Return the (possibly) updated {@linkcode MantraStorage}
   */
  private async updateMantras(): Promise<MantraStorage> {
    const { mantras, usedMantras } = await this.loadStorage();
    const [notes, notesChanged] = await this.fetchNotes();
    // nothing to update if the notes haven't changed
    if (!notesChanged) {
      return { mantras, usedMantras };
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: MantraManager.sysPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          rawNotes: notes,
          existingMantras: Object.values(mantras),
        }),
      },
    ];

    let newMantras: string[];
    // set once `chat` resolves, so a malformed-response error below can still
    // be traced back to the stored convo that produced it
    let convoId: string | undefined;
    try {
      const [res, id] = await this.llm.chat(this.model, messages);
      convoId = id;

      let parsedRes: unknown;
      try {
        parsedRes = JSON.parse(res);
      } catch (_) {
        throw new Error(`LLM response was not valid JSON`);
      }
      if (
        !parsedRes ||
        typeof parsedRes !== 'object' ||
        !Array.isArray((parsedRes as { mantras?: unknown }).mantras)
      ) {
        throw new Error(`LLM response was missing a "mantras" array`);
      }

      newMantras = (parsedRes as { mantras: string[] }).mantras;
    } catch (error) {
      throw toLLMError(error, convoId);
    }

    for (const mantra of newMantras) {
      mantras[hashString(mantra)] = mantra;
    }
    const storage = { mantras, usedMantras };

    await this.saveStorage(storage);
    return storage;
  }

  private async loadStorage(): Promise<MantraStorage> {
    const { mantraStorageFile } = MantraManager;
    if (await pathExists(mantraStorageFile)) {
      try {
        return JSON.parse(
          await fs.readFile(mantraStorageFile, 'utf-8')
        ) as MantraStorage;
      } catch (_) {}
    }

    // return empty storage if we couldn't load storage
    return { mantras: {}, usedMantras: [] };
  }

  private async saveStorage(storage: MantraStorage) {
    await fs.writeFile(
      MantraManager.mantraStorageFile,
      JSON.stringify(storage)
    );
  }

  private async fetchNotes(): Promise<
    [notes: string, contentChanged: boolean]
  > {
    const { notesCacheFile } = MantraManager;

    let origShasum = '';
    if (await pathExists(notesCacheFile)) {
      origShasum = await getFileShasum(notesCacheFile);
    }

    // re-fetch notes and overwrite cache file
    const notes = await fetchNotes();
    if (notes.trim().length === 0) {
      throw new Error(`'fetchNotes' returned an empty string`);
    }
    await fs.writeFile(notesCacheFile, notes);

    const newShasum = await getFileShasum(notesCacheFile);
    return [notes, newShasum !== origShasum];
  }

  private resolveLLM(): [llm: LLM, model: string] {
    const modelProvider = getEnvStrict('LLM_PROVIDER') as ModelProvider;
    if (!modelProviders.includes(modelProvider)) {
      throw new Error(
        `LLM_PROVIDER must be one of: ${modelProviders.join(', ')}`
      );
    }

    const llm = resolveLLM({
      modelProvider,
      baseUrl:
        modelProvider === 'ollama'
          ? getEnv('OLLAMA_HOST', 'http://localhost:11434')
          : undefined,
      apiKey:
        modelProvider === 'ollama'
          ? undefined
          : modelProvider === 'openai'
            ? getEnvStrict('OPENAI_TOKEN')
            : getEnvStrict('ANTHROPIC_TOKEN'),
    });

    return [llm, MantraManager.llmModels[modelProvider]];
  }
}

export const mantras = new MantraManager();
// clear convos at process start so the dir doesn't get too full
await LLM.clearConvos();

/** Record<id: string, value: string> */
type Mantras = Record<string, string>;

interface MantraStorage {
  mantras: Mantras;
  usedMantras: string[];
}
