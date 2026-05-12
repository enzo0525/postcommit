import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { execa } from 'execa';
import { copyToClipboard } from '../../src/lib/clipboard.js';

beforeEach(() => vi.mocked(execa).mockReset());

describe('clipboard', () => {
  it('pipes text to pbcopy', async () => {
    vi.mocked(execa).mockResolvedValueOnce({ stdout: '' } as never);
    await copyToClipboard('hello world');
    expect(execa).toHaveBeenCalledWith('pbcopy', [], { input: 'hello world' });
  });

  it('throws when pbcopy fails', async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error('nope'));
    await expect(copyToClipboard('x')).rejects.toThrow(/clipboard/i);
  });
});
