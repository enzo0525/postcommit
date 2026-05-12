import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  appendFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { execa } from 'execa';
import { paths } from './paths.js';

export const HOOK_SOURCE_LINE = '[ -f ~/.postcommit/hook.zsh ] && source ~/.postcommit/hook.zsh';
export const ALIAS_LINE = "alias tweet='postcommit tweet'";

const HOOK_BODY = `# postcommit banner — silent if nothing pending
command -v postcommit >/dev/null && postcommit banner 2>/dev/null
`;

function ensureZshrc(): string {
  const zshrc = paths.zshrc();
  if (!existsSync(zshrc)) writeFileSync(zshrc, '', 'utf8');
  return readFileSync(zshrc, 'utf8');
}

function appendOnce(line: string): void {
  const current = ensureZshrc();
  if (current.includes(line)) return;
  const sep = current.endsWith('\n') || current.length === 0 ? '' : '\n';
  appendFileSync(paths.zshrc(), `${sep}${line}\n`, 'utf8');
}

export function installShellHook(): void {
  mkdirSync(paths.configDir(), { recursive: true });
  writeFileSync(paths.hookFile(), HOOK_BODY, 'utf8');
  appendOnce(HOOK_SOURCE_LINE);
}

export function installAlias(): void {
  appendOnce(ALIAS_LINE);
  mkdirSync(paths.configDir(), { recursive: true });
  writeFileSync(join(paths.configDir(), '.alias'), '', 'utf8');
}

async function resolveBin(name: string): Promise<string | null> {
  try {
    const { stdout } = await execa('which', [name]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function plistXml(): Promise<string> {
  const postcommitPath = (await resolveBin('postcommit')) ?? 'postcommit';
  const ghPath = (await resolveBin('gh')) ?? 'gh';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.enzo.postcommit.refresh</string>
  <key>ProgramArguments</key>
  <array>
    <string>${postcommitPath}</string>
    <string>refresh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${ghPath.replace(/\/gh$/, '')}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin</string>
  </dict>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/postcommit.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/postcommit.err.log</string>
</dict>
</plist>
`;
}

export async function installLaunchdPlist(): Promise<void> {
  const file = paths.plistFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, await plistXml(), 'utf8');
  try {
    await execa('launchctl', ['unload', file]);
  } catch { /* not loaded yet — fine */ }
  try {
    await execa('launchctl', ['load', file]);
  } catch { /* surface in init log but don't crash hook installer */ }
}
