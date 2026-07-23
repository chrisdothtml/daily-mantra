import Router from '@koa/router';
import Koa from 'koa';
import path from 'node:path';
import { convosDir } from './constants.ts';
import { LLMError } from './LLMs/_LLM.ts';
import { mantras } from './mantras.ts';
import { getEnv } from './utils.ts';

const server = new Koa();
const api = new Router();
const PORT = parseInt(getEnv('PORT', '8000'));
const HOST = getEnv('HOST', 'localhost');

api.get('/ping', (ctx) => {
  ctx.body = 'pong';
});

api.get('/random-mantra', async (ctx) => {
  try {
    ctx.body = await mantras.getRandom();
  } catch (error) {
    ({ status: ctx.status, body: ctx.body } = toErrorResponse(error));
  }
});

api.post('/reset', async (ctx) => {
  try {
    await mantras.reset();
    ctx.body = 'OK';
  } catch (error) {
    ({ status: ctx.status, body: ctx.body } = toErrorResponse(error));
  }
});

server.use(api.routes()).use(api.allowedMethods());

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});

/**
 * Logs the error (pointing at the stored convo file when it's LLM-related,
 * so a failure can be traced back to exactly what was asked/received) and
 * returns the status/message a route should respond with. Kept as a plain
 * function so routes stay in charge of `ctx`.
 */
function toErrorResponse(error: unknown): { status: number; body: string } {
  if (error instanceof LLMError) {
    if (error.convoId) {
      console.error(
        'See convo:',
        path.join(convosDir, `${error.convoId}.json`)
      );
    }
    console.error(error);

    const msg = [error.title, error.msg].filter(Boolean).join(': ');
    return { status: 502, body: msg }; // bad gateway: our upstream (the LLM provider) failed
  }

  console.error(error);
  return {
    status: 500,
    body: error instanceof Error ? error.message : String(error),
  };
}
