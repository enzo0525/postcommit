import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setHome, paths } from '../../src/lib/paths.js';
import { readStyle, writeDefaultStyle, DEFAULT_STYLE } from '../../src/lib/style.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pc-style-'));
  setHome(tmp);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('style', () => {
  it('writeDefaultStyle creates file with DEFAULT_STYLE content', () => {
    writeDefaultStyle();
    expect(existsSync(paths.styleFile())).toBe(true);
    expect(readFileSync(paths.styleFile(), 'utf8')).toBe(DEFAULT_STYLE);
  });

  it('writeDefaultStyle does not overwrite existing file', () => {
    writeDefaultStyle();
    writeFileSync(paths.styleFile(), 'custom prompt');
    writeDefaultStyle();
    expect(readFileSync(paths.styleFile(), 'utf8')).toBe('custom prompt');
  });

  it('readStyle returns file contents', () => {
    writeDefaultStyle();
    expect(readStyle()).toBe(DEFAULT_STYLE);
  });

  it('readStyle returns DEFAULT_STYLE if file missing', () => {
    expect(readStyle()).toBe(DEFAULT_STYLE);
  });
});
