import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const MAX_OFFERS = 3;
export const RECALLS_BETWEEN_OFFERS = 5;
export const STATUSES = Object.freeze(['later', 'never']);

export function getStateFilePath() {
  return path.join(os.homedir(), '.xmemo', 'profile-offer.json');
}

export function readOfferState() {
  try {
    const filePath = getStateFilePath();
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return {
      status: typeof data?.status === 'string' ? data.status : null,
      recalls: Number.isInteger(data?.recalls) ? data.recalls : 0,
      offers: Number.isInteger(data?.offers) ? data.offers : 0,
      lastOfferRecalls: Number.isInteger(data?.lastOfferRecalls) ? data.lastOfferRecalls : 0,
    };
  } catch {
    return {
      status: null,
      recalls: 0,
      offers: 0,
      lastOfferRecalls: 0,
    };
  }
}

export function writeOfferState(state) {
  try {
    const filePath = getStateFilePath();
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Some platforms do not support POSIX permission bits
    }
    const payload = JSON.stringify({
      status: state.status ?? null,
      recalls: Number.isInteger(state.recalls) ? state.recalls : 0,
      offers: Number.isInteger(state.offers) ? state.offers : 0,
      lastOfferRecalls: Number.isInteger(state.lastOfferRecalls) ? state.lastOfferRecalls : 0,
    }, null, 2) + '\n';
    fs.writeFileSync(filePath, payload, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best effort chmod
    }
  } catch {
    // Load and save failures are silent and never change command outcome
  }
}

export function recordOfferAnswer(status) {
  if (!STATUSES.includes(status)) {
    const err = new Error(`Invalid status: '${status}'. Allowed values: ${STATUSES.join(', ')}.`);
    err.exitCode = 1;
    throw err;
  }

  const state = readOfferState();
  if (status === 'later') {
    if (state.status !== 'later' || !state.offers) {
      state.offers = 1;
      state.lastOfferRecalls = state.recalls;
    } else {
      state.lastOfferRecalls = state.recalls;
    }
    state.status = 'later';
  } else if (status === 'never') {
    state.status = 'never';
  }

  writeOfferState(state);
  return state;
}

export function noteRecall() {
  try {
    const state = readOfferState();
    if (state.status !== 'later') {
      return null;
    }

    state.recalls = (state.recalls || 0) + 1;
    const recallsSinceLastOffer = state.recalls - (state.lastOfferRecalls || 0);

    if (recallsSinceLastOffer >= RECALLS_BETWEEN_OFFERS && state.offers < MAX_OFFERS) {
      state.offers = (state.offers || 0) + 1;
      state.lastOfferRecalls = state.recalls;
      writeOfferState(state);
      return `Note: recall has been used ${state.recalls} times. If this project's AGENTS.md or CLAUDE.md has no "## XMemo memory" section, you may offer once more to add it (see references/agent-profile.md) and record the answer with \`profile --status later|never\`.`;
    }

    writeOfferState(state);
    return null;
  } catch {
    return null;
  }
}

export function armRecallNote() {
  process.once('exit', (code) => {
    if (code !== 0) return;
    const note = noteRecall();
    if (note) {
      try {
        fs.writeSync(2, `${note}\n`);
      } catch {
        // The note is optional.
      }
    }
  });
}
