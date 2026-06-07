import os from 'node:os';
import path from 'node:path';

import { fileExists } from '../runtime.js';
import { defaultCopilotConfigPath } from './paths.js';

export async function detectClient(clientId, env, mcpClients) {
  let filePaths = [];
  if (clientId === 'copilot-cli' || clientId === 'copilot') {
    if (process.platform === 'win32' && env.APPDATA) {
      filePaths.push(path.join(env.APPDATA, 'Code', 'User', 'mcp.json'));
    } else {
      const home = env.HOME || os.homedir();
      if (process.platform === 'darwin') {
        filePaths.push(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'));
      }
      filePaths.push(path.join(home, '.config', 'Code', 'User', 'mcp.json'));
    }
    filePaths.push(defaultCopilotConfigPath(env));
  } else {
    const client = mcpClients.get(clientId);
    if (client) {
      filePaths.push(client.defaultConfigPath(env));
    }
  }

  if (clientId === 'cline') {
    if (process.platform === 'win32' && env.APPDATA) {
      filePaths.push(path.join(env.APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
    } else {
      const home = env.HOME || os.homedir();
      if (process.platform === 'darwin') {
        filePaths.push(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
      }
      filePaths.push(path.join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
    }
  }

  for (const filePath of filePaths) {
    if (await fileExists(filePath)) {
      return { detected: true, path: filePath };
    }
    const parentDir = path.dirname(filePath);
    if (await fileExists(parentDir)) {
      return { detected: true, path: filePath };
    }
  }

  return { detected: false };
}
