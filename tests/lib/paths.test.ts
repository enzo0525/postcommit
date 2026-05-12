import { describe, it, expect, beforeEach } from 'vitest';
import { paths, setHome } from '../../src/lib/paths.js';

describe('paths', () => {
  beforeEach(() => setHome('/tmp/pc-test'));

  it('derives configDir under home', () => {
    expect(paths.configDir()).toBe('/tmp/pc-test/.postcommit');
  });

  it('derives all known files under configDir', () => {
    expect(paths.dbFile()).toBe('/tmp/pc-test/.postcommit/state.db');
    expect(paths.cacheFile()).toBe('/tmp/pc-test/.postcommit/cache.json');
    expect(paths.styleFile()).toBe('/tmp/pc-test/.postcommit/style.txt');
    expect(paths.envFile()).toBe('/tmp/pc-test/.postcommit/.env');
    expect(paths.hookFile()).toBe('/tmp/pc-test/.postcommit/hook.zsh');
  });

  it('derives zshrc and plist under home', () => {
    expect(paths.zshrc()).toBe('/tmp/pc-test/.zshrc');
    expect(paths.plistFile()).toBe('/tmp/pc-test/Library/LaunchAgents/com.enzo.postcommit.refresh.plist');
  });
});
