import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import stream from 'node:stream/promises';
import * as tar from 'tar';
import { getEnv, getEnvStrict } from './utils.ts';

/**
 * Fetches all the source notes files and combines them into
 * a single string
 */
export async function fetchNotes(): Promise<string> {
  const repoName = getEnvStrict('NOTES_REPO_SLUG');
  const repoRef = getEnv('NOTES_REPO_REF', 'main');
  const tmpRepoDir = await fetchGHRepoFiles(repoName, repoRef);

  const targets = getEnv('NOTES_REPO_FILES_AND_DIRS', '').split(/, ?/);
  const notesFilePaths = await listFiles(tmpRepoDir, targets);

  const documents: string[] = [];
  for (const filePath of notesFilePaths) {
    documents.push(await fs.readFile(filePath, 'utf-8'));
  }

  return documents.join('\n\n');
}

/**
 * Collects files from the provided directory, optionally including
 * only those matching the provided files or directories via `targets`
 * (if a target is a directory, collects all the files within it)
 */
async function listFiles(
  dirPath: string,
  targets?: string[]
): Promise<string[]> {
  if (!targets || targets.length === 0) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(dirPath, entry.name));
  }

  const results = await Promise.all(
    targets.map(async (target) => {
      const targetPath = path.join(dirPath, target);
      const stat = await fs.stat(targetPath);
      return stat.isDirectory() ? listFiles(targetPath) : [targetPath];
    })
  );

  return results.flat();
}

/**
 * Downloads a tarball of the provided GH repo and extracts
 * it into a temporary dir, returning the temp dir path
 */
async function fetchGHRepoFiles(
  repoSlug: string,
  ref: string
): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${repoSlug}/tarball/${encodeURIComponent(ref)}`,
    {
      headers: {
        Authorization: `Bearer ${getEnvStrict('GITHUB_TOKEN')}`,
        Accept: 'application/vnd.github+json',
      },
    }
  );

  if (!res.ok || !res.body) {
    throw new Error(
      `Failed to download ${repoSlug}@${ref}: ${res.status} ${res.statusText}`
    );
  }

  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gh-repo-'));
  await stream.pipeline(
    res.body,
    tar.extract({
      cwd: outputDir,
      strip: 1,
    })
  );

  return outputDir;
}
