import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { XMemoClient } from '../client/xmemoMcpClient';
import { DEFAULT_AGENT_ID, DEFAULT_SERVICE_URL, TOKEN_SECRET_KEY } from '../constants';

export const AUTH_ID = 'xmemo';
export const AUTH_LABEL = 'XMemo';
export const AUTH_SCOPES: string[] = [];

const PUBLISHER = 'xmemo';
const EXT_NAME = 'xmemo-vscode';
const SESSION_ID = 'xmemo-session';
const INSTANCE_ID_KEY = 'xmemo.agentInstanceId';
const OAUTH_META_KEY = 'xmemo.oauthMeta';
const DEFAULT_SCOPE = 'offline_access';

interface TokenRecord {
  kind: 'oauth' | 'bearer';
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  account_label?: string;
}

interface OAuthMeta {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  client_id: string;
  scope: string;
  resource: string;
}

interface DiscoveryDoc {
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  resource?: string;
  mcp_endpoint?: string;
  protected_resource_metadata_endpoint?: string;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Real VS Code AuthenticationProvider for XMemo, so the extension integrates with
 * the Accounts UI and other code can call vscode.authentication.getSession('xmemo').
 *
 * Primary path: OAuth 2.0 (PKCE) with discovery + Dynamic Client Registration.
 * Fallback path: bearer token paste (codex-style XMEMO_KEY), used automatically
 * if any OAuth step fails or the user opts out. Tokens always live in
 * SecretStorage (OS keychain) — never in settings or files.
 */
export class XMemoAuth implements vscode.AuthenticationProvider {
  private readonly _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this._onDidChangeSessions.event;

  // Facade event for status bar / tree refresh.
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private readonly pending = new Map<string, { resolve: (code: string) => void; reject: (e: Error) => void }>();

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      this._onDidChangeSessions,
      this._onDidChange,
      vscode.window.registerUriHandler({ handleUri: (uri) => this.handleCallback(uri) }),
      vscode.authentication.registerAuthenticationProvider(AUTH_ID, AUTH_LABEL, this, {
        supportsMultipleAccounts: false
      })
    );
  }

  // ---- AuthenticationProvider API ----

  async getSessions(_scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    const rec = await this.readRecord();
    if (!rec) {
      return [];
    }
    const fresh = await this.maybeRefresh(rec);
    return [this.toSession(fresh)];
  }

  async createSession(_scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
    const record = await this.acquire();
    await this.store(record);

    // Verify end-to-end and capture the account label (get_mcp_identity).
    try {
      const client = await this.buildClient(record.access_token);
      record.account_label = (await client.verify()).split('\n')[0].slice(0, 80);
      await this.store(record);
    } catch (error: any) {
      await this.context.secrets.delete(TOKEN_SECRET_KEY);
      throw new Error(`XMemo sign-in failed: ${error?.message ?? error}`);
    }

    const session = this.toSession(record);
    this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
    this._onDidChange.fire();
    return session;
  }

  async removeSession(_sessionId: string): Promise<void> {
    const rec = await this.readRecord();
    await this.context.secrets.delete(TOKEN_SECRET_KEY);
    if (rec) {
      this._onDidChangeSessions.fire({ added: [], removed: [this.toSession(rec)], changed: [] });
    }
    this._onDidChange.fire();
  }

  // ---- Facade used by commands / MCP provider ----

  async signIn(): Promise<boolean> {
    try {
      const session = await vscode.authentication.getSession(AUTH_ID, AUTH_SCOPES, { createIfNone: true });
      if (!session) {
        return false;
      }
      vscode.window.showInformationMessage(`XMemo: signed in (${session.account.label}).`);
      return true;
    } catch (error: any) {
      vscode.window.showErrorMessage(`XMemo: ${error?.message ?? error}`);
      return false;
    }
  }

  async signOut(): Promise<void> {
    await this.removeSession(SESSION_ID);
    vscode.window.showInformationMessage('XMemo: signed out.');
  }

  async isSignedIn(): Promise<boolean> {
    const session = await vscode.authentication.getSession(AUTH_ID, AUTH_SCOPES, { createIfNone: false });
    return Boolean(session);
  }

  async getToken(): Promise<string | undefined> {
    const session = await vscode.authentication.getSession(AUTH_ID, AUTH_SCOPES, { createIfNone: false });
    return session?.accessToken;
  }

  async getTokenOrSignIn(): Promise<string | undefined> {
    const session = await vscode.authentication.getSession(AUTH_ID, AUTH_SCOPES, { createIfNone: true });
    return session?.accessToken;
  }

  async getClient(): Promise<XMemoClient | undefined> {
    const token = await this.getToken();
    if (!token) {
      return undefined;
    }
    return this.buildClient(token);
  }

  async agentInstanceId(): Promise<string> {
    let id = this.context.globalState.get<string>(INSTANCE_ID_KEY);
    if (!id) {
      const host = (vscode.env.machineId || 'device').slice(0, 12);
      id = `xmemo-vscode-${host}-${Math.random().toString(36).slice(2, 8)}`;
      await this.context.globalState.update(INSTANCE_ID_KEY, id);
    }
    return id;
  }

  // ---- internals ----

  private config() {
    const cfg = vscode.workspace.getConfiguration('xmemo');
    return {
      baseUrl: (cfg.get<string>('apiBaseUrl') || DEFAULT_SERVICE_URL).replace(/\/$/, ''),
      agentId: cfg.get<string>('agentId') || DEFAULT_AGENT_ID
    };
  }

  private async buildClient(token: string): Promise<XMemoClient> {
    const { baseUrl, agentId } = this.config();
    return new XMemoClient({ baseUrl, token, agentId, agentInstanceId: await this.agentInstanceId() });
  }

  private toSession(rec: TokenRecord): vscode.AuthenticationSession {
    return {
      id: SESSION_ID,
      accessToken: rec.access_token,
      account: { id: AUTH_ID, label: rec.account_label || 'XMemo' },
      scopes: AUTH_SCOPES
    };
  }

  private async readRecord(): Promise<TokenRecord | undefined> {
    const raw = await this.context.secrets.get(TOKEN_SECRET_KEY);
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as TokenRecord;
    } catch {
      return { kind: 'bearer', access_token: raw };
    }
  }

  private async store(rec: TokenRecord): Promise<void> {
    await this.context.secrets.store(TOKEN_SECRET_KEY, JSON.stringify(rec));
  }

  private async maybeRefresh(rec: TokenRecord): Promise<TokenRecord> {
    if (rec.kind === 'oauth' && rec.refresh_token && rec.expires_at && Date.now() > rec.expires_at - 60_000) {
      const refreshed = await this.refresh(rec.refresh_token).catch(() => undefined);
      if (refreshed) {
        refreshed.account_label = rec.account_label;
        await this.store(refreshed);
        return refreshed;
      }
    }
    return rec;
  }

  /** OAuth first; on any failure, offer token paste. */
  private async acquire(): Promise<TokenRecord> {
    try {
      return await this.acquireOAuth();
    } catch (error: any) {
      const choice = await vscode.window.showWarningMessage(
        `XMemo OAuth sign-in unavailable (${error?.message ?? error}). Use a token instead?`,
        'Paste Token',
        'Cancel'
      );
      if (choice !== 'Paste Token') {
        throw new Error('sign-in cancelled');
      }
      const rec = await this.acquireToken();
      if (!rec) {
        throw new Error('sign-in cancelled');
      }
      return rec;
    }
  }

  // ---- OAuth PKCE ----

  private async acquireOAuth(): Promise<TokenRecord> {
    const meta = await this.ensureOAuthMeta();
    const redirectUri = await this.callbackUri();

    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));

    const authUrl = new URL(meta.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', meta.client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    if (meta.resource) {
      authUrl.searchParams.set('resource', meta.resource);
    }
    if (meta.scope) {
      authUrl.searchParams.set('scope', meta.scope);
    }

    const codePromise = new Promise<string>((resolve, reject) => {
      this.pending.set(state, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(state)) {
          reject(new Error('sign-in timed out'));
        }
      }, 300_000);
    });

    await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));
    const code = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'XMemo: waiting for browser sign-in...' },
      () => codePromise
    );
    return this.exchangeCode(meta, code, verifier, redirectUri);
  }

  private handleCallback(uri: vscode.Uri): void {
    const params = new URLSearchParams(uri.query);
    const state = params.get('state') ?? '';
    const entry = this.pending.get(state);
    if (!entry) {
      return;
    }
    this.pending.delete(state);
    const error = params.get('error');
    const code = params.get('code');
    if (error) {
      entry.reject(new Error(error));
    } else if (code) {
      entry.resolve(code);
    } else {
      entry.reject(new Error('no authorization code in callback'));
    }
  }

  private async callbackUri(): Promise<string> {
    const external = await vscode.env.asExternalUri(
      vscode.Uri.parse(`${vscode.env.uriScheme}://${PUBLISHER}.${EXT_NAME}/auth-callback`)
    );
    const callback = external.toString(true);
    try {
      return decodeURIComponent(callback);
    } catch {
      return callback;
    }
  }

  private async ensureOAuthMeta(): Promise<OAuthMeta> {
    const { baseUrl } = this.config();
    const cached = this.context.globalState.get<OAuthMeta>(OAUTH_META_KEY);
    if (cached && cached.authorization_endpoint.startsWith(baseUrl) && cached.resource) {
      return cached;
    }
    const discovery = await this.discover(baseUrl);
    const meta: OAuthMeta = {
      authorization_endpoint: discovery.authorization_endpoint ?? `${baseUrl}/oauth/authorize`,
      token_endpoint: discovery.token_endpoint ?? `${baseUrl}/oauth/token`,
      registration_endpoint: discovery.registration_endpoint ?? `${baseUrl}/oauth/register`,
      client_id: '',
      scope: (discovery.scopes_supported && discovery.scopes_supported.join(' ')) || DEFAULT_SCOPE,
      resource: discovery.resource || discovery.mcp_endpoint || `${baseUrl}/mcp`
    };
    meta.client_id = await this.registerClient(meta.registration_endpoint!);
    await this.context.globalState.update(OAUTH_META_KEY, meta);
    return meta;
  }

  private async discover(baseUrl: string): Promise<DiscoveryDoc> {
    const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`, {
      headers: { accept: 'application/json' }
    });
    if (!res.ok) {
      throw new Error(await this.httpError(res, 'discovery failed'));
    }
    return (await res.json()) as DiscoveryDoc;
  }

  private async registerClient(registrationEndpoint: string): Promise<string> {
    const redirectUri = await this.callbackUri();
    const res = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'XMemo VSCode',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'native'
      })
    });
    if (!res.ok) {
      throw new Error(await this.httpError(res, 'client registration failed'));
    }
    const data = (await res.json()) as { client_id?: string };
    if (!data.client_id) {
      throw new Error('registration returned no client_id');
    }
    return data.client_id;
  }

  private async exchangeCode(meta: OAuthMeta, code: string, verifier: string, redirectUri: string): Promise<TokenRecord> {
    const res = await fetch(meta.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: meta.client_id,
        code_verifier: verifier,
        resource: meta.resource
      })
    });
    if (!res.ok) {
      throw new Error(await this.httpError(res, 'token exchange failed'));
    }
    return this.toRecord((await res.json()) as Record<string, any>);
  }

  private async refresh(refreshToken: string): Promise<TokenRecord | undefined> {
    const meta = this.context.globalState.get<OAuthMeta>(OAUTH_META_KEY);
    if (!meta) {
      return undefined;
    }
    const res = await fetch(meta.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: meta.client_id
      })
    });
    if (!res.ok) {
      return undefined;
    }
    return this.toRecord((await res.json()) as Record<string, any>, refreshToken);
  }

  private async httpError(res: Response, prefix: string): Promise<string> {
    let detail = '';
    try {
      const body = (await res.clone().json()) as Record<string, any>;
      detail = String(body.error_description || body.detail || body.error || '').trim();
    } catch {
      try {
        detail = (await res.text()).trim().slice(0, 300);
      } catch {
        detail = '';
      }
    }
    return detail ? `${prefix} (HTTP ${res.status}: ${detail})` : `${prefix} (HTTP ${res.status})`;
  }

  private toRecord(data: Record<string, any>, fallbackRefresh?: string): TokenRecord {
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : undefined;
    return {
      kind: 'oauth',
      access_token: String(data.access_token),
      refresh_token: data.refresh_token ?? fallbackRefresh,
      expires_at: expiresIn ? Date.now() + expiresIn * 1000 : undefined
    };
  }

  // ---- token paste fallback ----

  private async acquireToken(): Promise<TokenRecord | undefined> {
    const token = await vscode.window.showInputBox({
      title: 'Sign in to XMemo',
      prompt: 'Paste your XMemo token (XMEMO_KEY). Stored in the OS keychain, never in settings or files.',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'xmemo_...'
    });
    if (!token?.trim()) {
      return undefined;
    }
    return { kind: 'bearer', access_token: token.trim() };
  }
}
