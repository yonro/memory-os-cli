import { optionValue } from './args.js';
import { DEFAULT_SERVICE_URL } from './constants.js';

export function baseUrlOption(args, env) {
  return optionValue(args, '--base-url')
    ?? optionValue(args, '--url')
    ?? env.XMEMO_BASE_URL
    ?? env.XMEMO_URL
    ?? env.MEMORY_OS_BASE_URL
    ?? env.MEMORY_OS_URL
    ?? DEFAULT_SERVICE_URL;
}
