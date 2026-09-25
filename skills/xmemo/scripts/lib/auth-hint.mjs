import { SCRIPT_COMMAND, EXIT_CODE } from './core.mjs';
export { EXIT_CODE };

export function resolveCredentialSource(credential) {
  const storage = credential?.storage;
  if (storage === 'openclaw-secret') return 'openclaw-secret';
  if (storage === 'vault') return 'vault';
  if (storage === 'environment') return 'environment';
  return 'file';
}

export function formatAuthErrorHint(credential) {
  const source = resolveCredentialSource(credential);
  return `Credential source: ${source}. Run \`${SCRIPT_COMMAND} auth status --verify\` to check it.`;
}

export function printAuthErrorHint(credential, options = {}) {
  if (options && options.json) return;
  console.error(formatAuthErrorHint(credential));
}
