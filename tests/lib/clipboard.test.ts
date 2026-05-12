import { describe, it, expect, mock, beforeEach } from 'bun:test';

const execaMock = mock(() => Promise.resolve({ stdout: '' } as never));
mock.module('execa', () => ({ execa: execaMock }));

import { copyToClipboard } from '../../src/lib/clipboard.js';

beforeEach(() => execaMock.mockReset());

describe('clipboard', () => {
  it('pipes text to pbcopy', async () => {
    execaMock.mockResolvedValueOnce({ stdout: '' } as never);
    await copyToClipboard('hello world');
    expect(execaMock).toHaveBeenCalledWith('pbcopy', [], { input: 'hello world' });
  });

  it('throws when pbcopy fails', async () => {
    execaMock.mockRejectedValueOnce(new Error('nope'));
    await expect(copyToClipboard('x')).rejects.toThrow(/clipboard/i);
  });
});
