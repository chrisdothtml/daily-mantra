import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const dataDir = path.join(os.homedir(), '.daily-mantra');
export const cacheDir = path.join(dataDir, '.cache');
export const convosDir = path.join(dataDir, '.convos');

for (const dir of [cacheDir, convosDir]) {
  await fs.mkdir(dir, { recursive: true });
}
