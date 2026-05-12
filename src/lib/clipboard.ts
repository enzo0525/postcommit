import { execa } from 'execa';

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await execa('pbcopy', [], { input: text });
  } catch (err) {
    throw new Error(`Failed to copy to clipboard: ${(err as Error).message}`);
  }
}
