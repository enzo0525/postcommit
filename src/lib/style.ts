import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { paths } from './paths.js';

export const DEFAULT_STYLE = `You are drafting a single tweet for an indie maker building in public.

Input: a list of git commits with messages, repos, and timestamps.
Output: ONE tweet, max 240 chars, that reads like a real human shipped real work.

Rules:
- Mention the project name once if it's recognizable
- Refer to specific things you shipped — not "shipped some stuff"
- Casual voice, lowercase OK, no corporate-speak
- Zero hashtags, max 1 emoji
- End with an open thought, a number, or a question — never "stay tuned"
- If commits look like noise (typos, lint), pick the meatiest 2-3 and ignore the rest
`;

export function writeDefaultStyle(): void {
  mkdirSync(paths.configDir(), { recursive: true });
  if (existsSync(paths.styleFile())) return;
  writeFileSync(paths.styleFile(), DEFAULT_STYLE, 'utf8');
}

export function readStyle(): string {
  if (!existsSync(paths.styleFile())) return DEFAULT_STYLE;
  return readFileSync(paths.styleFile(), 'utf8');
}
