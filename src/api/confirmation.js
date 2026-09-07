import { createInterface } from 'node:readline/promises';

import { hasFlag } from '../core/args.js';
import { ConfirmationRequiredError } from './errors.js';

export async function confirmRemoteAction(args, io, message) {
  if (hasFlag(args, '--yes')) return;
  if (io.preflightOnly) throw new ConfirmationRequiredError(message);
  if (hasFlag(args, '--json') || !io.stdin?.isTTY) throw new ConfirmationRequiredError(message);
  let accepted;
  if (typeof io.confirm === 'function') {
    accepted = await io.confirm(`${message} [y/N] `);
  } else {
    const prompt = createInterface({ input: io.stdin, output: io.stderr });
    try {
      const answer = await prompt.question(`${message} [y/N] `);
      accepted = /^(y|yes)$/i.test(answer.trim());
    } finally {
      prompt.close();
    }
  }
  if (!accepted) throw new ConfirmationRequiredError('Operation cancelled before any remote write.');
}
