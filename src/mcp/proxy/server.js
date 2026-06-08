import http from 'node:http';

import { optionValue, parsePositiveInteger } from '../../core/args.js';
import {
  AGENT_ID_HEADER,
  AGENT_INSTANCE_HEADER,
  CLI_VERSION,
  COMMAND_NAME,
  DEFAULT_SERVICE_URL,
  DEFAULT_PROXY_HOST,
  DEFAULT_PROXY_PORT,
  PRODUCT_NAME,
  TOKEN_ENV_VAR
} from '../../core/constants.js';
import { credentialsPath, resolveCredentialToken, validateToken } from '../../network/auth.js';
import { endpointUrl, normalizeBaseUrl } from '../../network/http.js';
import { UsageError } from '../../core/errors.js';
import { writeLine } from '../../core/io.js';
import { closeServer, readAll, waitForShutdown } from '../../core/runtime.js';

export async function mcpProxyCommand(args, io, { agentIdentity }) {
  const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
  const mcpUrl = endpointUrl(baseUrl, '/mcp');
  const host = optionValue(args, '--host') ?? DEFAULT_PROXY_HOST;
  const port = parsePositiveInteger(optionValue(args, '--port') ?? String(DEFAULT_PROXY_PORT), '--port');
  const token = await resolveCredentialToken(io.env);
  if (!token) {
    throw new UsageError(`No token found. Run \`${COMMAND_NAME} login\` or \`${COMMAND_NAME} token add --from-stdin\` first.`);
  }
  validateToken(token);
  const identity = await agentIdentity('copilot-cli', io.env);

  const server = http.createServer(async (request, response) => {
    try {
      await handleMcpProxyRequest({ request, response, mcpUrl, token, identity, io });
    } catch (error) {
      response.statusCode = 502;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: 'mcp_proxy_error', message: error.message }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  writeLine(io.stdout, `${PRODUCT_NAME} MCP proxy listening on http://${host}:${port}/mcp`);
  writeLine(io.stdout, `Forwarding to ${mcpUrl}`);
  writeLine(io.stdout, `Credential source: ${TOKEN_ENV_VAR} or ${credentialsPath(io.env)}`);
  if (io.keepAlive === false) {
    await closeServer(server);
    return 0;
  }

  await waitForShutdown(server, io);
  return 0;
}

async function handleMcpProxyRequest({ request, response, mcpUrl, token, identity, io }) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? `${DEFAULT_PROXY_HOST}:${DEFAULT_PROXY_PORT}`}`);
  if (request.method !== 'POST' || requestUrl.pathname !== '/mcp') {
    response.statusCode = 404;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const body = await readAll(request);
  const upstreamHeaders = {
    accept: String(request.headers.accept || 'application/json, text/event-stream'),
    'content-type': String(request.headers['content-type'] || 'application/json'),
    authorization: `Bearer ${token}`,
    [AGENT_ID_HEADER]: identity.agentId,
    [AGENT_INSTANCE_HEADER]: identity.agentInstanceId,
    'user-agent': `XMemo-CLI-Proxy/${CLI_VERSION} (+https://github.com/yonro/memory-os-cli)`
  };
  const sessionId = request.headers['mcp-session-id'];
  if (sessionId) {
    upstreamHeaders['mcp-session-id'] = Array.isArray(sessionId) ? sessionId[0] : sessionId;
  }

  const upstream = await io.fetch(mcpUrl, {
    method: 'POST',
    headers: upstreamHeaders,
    body
  });

  response.statusCode = upstream.status;
  for (const header of ['content-type', 'mcp-session-id']) {
    const value = upstream.headers.get(header);
    if (value) {
      response.setHeader(header, value);
    }
  }
  const buffer = Buffer.from(await upstream.arrayBuffer());
  response.end(buffer);
}

function baseUrlOption(args, env) {
  return optionValue(args, '--url')
    ?? optionValue(args, '--base-url')
    ?? env.XMEMO_URL
    ?? env.XMEMO_BASE_URL
    ?? env.MEMORY_OS_URL
    ?? env.MEMORY_OS_BASE_URL
    ?? DEFAULT_SERVICE_URL;
}

