import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setHome, paths } from '../../src/lib/paths.js';

const execaMock = mock(() => Promise.resolve({ stdout: '' } as never));
mock.module('execa', () => ({ execa: execaMock }));

import {
  installShellHook,
  installAlias,
  installLaunchdPlist,
  HOOK_SOURCE_LINE,
  ALIAS_LINE,
} from '../../src/lib/hooks.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pc-hooks-'));
  setHome(tmp);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('hooks', () => {
  it('installShellHook writes hook.zsh with banner call', () => {
    writeFileSync(paths.zshrc(), '# existing\n');
    installShellHook();
    const hookContent = readFileSync(paths.hookFile(), 'utf8');
    expect(hookContent).toContain('postcommit banner');
    expect(readFileSync(paths.zshrc(), 'utf8')).toContain(HOOK_SOURCE_LINE);
  });

  it('installShellHook is idempotent (does not duplicate source line)', () => {
    writeFileSync(paths.zshrc(), '# existing\n');
    installShellHook();
    installShellHook();
    const zshrc = readFileSync(paths.zshrc(), 'utf8');
    const occurrences = zshrc.split(HOOK_SOURCE_LINE).length - 1;
    expect(occurrences).toBe(1);
  });

  it('installShellHook creates .zshrc if it does not exist', () => {
    installShellHook();
    expect(existsSync(paths.zshrc())).toBe(true);
    expect(readFileSync(paths.zshrc(), 'utf8')).toContain(HOOK_SOURCE_LINE);
  });

  it('installAlias appends alias line idempotently', () => {
    writeFileSync(paths.zshrc(), '');
    installAlias();
    installAlias();
    const zshrc = readFileSync(paths.zshrc(), 'utf8');
    expect(zshrc.split(ALIAS_LINE).length - 1).toBe(1);
  });

  it('installLaunchdPlist writes plist with 900s interval', async () => {
    await installLaunchdPlist();
    const plist = readFileSync(paths.plistFile(), 'utf8');
    expect(plist).toContain('com.enzo.postcommit.refresh');
    expect(plist).toContain('<integer>900</integer>');
    expect(plist).toMatch(/<string>[^<]*postcommit<\/string>/);
  });

  it('installAlias writes .alias sentinel file', () => {
    writeFileSync(paths.zshrc(), '');
    installAlias();
    expect(existsSync(join(paths.configDir(), '.alias'))).toBe(true);
  });
});
