import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import process from 'node:process';

export function getEnv(key: string, fallback: string): string;
export function getEnv(key: string, fallback?: undefined): string | null;
export function getEnv(key: string, fallback?: string): string | null {
  if (
    process.env.hasOwnProperty(key) &&
    typeof process.env[key] === 'string' &&
    process.env[key].length > 0
  ) {
    return process.env[key] as string;
  }

  return fallback ?? null;
}

/**
 * Gets an env var, throwing an excetion if it does't exist
 */
export function getEnvStrict(key: string) {
  const value = getEnv(key);
  if (value == null) {
    throw new Error(`Required environment var '${key}' not set`);
  }
  return value;
}

export async function pathExists(input: string) {
  return fs
    .access(input)
    .then(() => true)
    .catch(() => false);
}

export async function getFileShasum(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fsSync.createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest('hex');
}

export function hashString(text: string): string {
  return crypto
    .createHash('sha256')
    .update(text, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

/**
 * Dedent a multiline string based on the indentation of the first non-empty line.
 */
export function dedent(str: string): string {
  const lines = str.replace(/^(?:\r?\n)*|(?:\r?\n)*\s*$/g, '').split(/\r?\n/);

  // determine the indent level
  let indentLevel = null;
  for (const line of lines) {
    if (line.trim() !== '') {
      const match = line.match(/^(\s*)/);
      indentLevel = match ? match[1] : '';
      break;
    }
  }
  if (indentLevel === null || indentLevel === '') {
    return str;
  }
  const indentLength = indentLevel.length;

  // dedent each line based on the indentation level
  return lines
    .map((line) => {
      const lineMatch = line.match(/^(\s*)/);
      const lineIndent = lineMatch ? lineMatch[1] : '';
      const removeLength = Math.min(indentLength, lineIndent.length);
      return line.substring(removeLength);
    })
    .join('\n');
}
