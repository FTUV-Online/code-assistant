import * as vscode from 'vscode';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import * as log from '../util/logger';

const CLIENT_NAME = 'dev-code VS Code Extension';

export class McpOAuthProvider implements OAuthClientProvider {
  private _redirectUrl: string | undefined;
  private _allowBrowserRedirect = false;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly serverName: string,
    private readonly scope?: string,
  ) {}

  /**
   * Set the loopback redirect URL for the current OAuth flow. Must be called
   * before the SDK's `auth()` orchestrator runs (so DCR + authorize use the
   * right port) and remain set until token exchange completes (the SDK reads
   * it again in `prepareAuthorizationCodeRequest`).
   */
  setRedirectUrl(url: string): void {
    this._redirectUrl = url;
  }

  /**
   * Toggle whether `redirectToAuthorization` is allowed to open a browser.
   * Stays `false` during background connect attempts (so an unauthenticated
   * server doesn't spawn a browser on extension startup) and is set to `true`
   * only inside the explicit user-initiated startOAuth flow.
   */
  setBrowserRedirectAllowed(allowed: boolean): void {
    this._allowBrowserRedirect = allowed;
  }

  // RFC 8252 loopback redirect — works on every OAuth server that supports
  // native apps, and avoids vendor-specific custom URI scheme allowlisting.
  //
  // When no active flow has set a port-specific URL, fall back to the
  // canonical port-less form: per RFC 8252 §7.3 the auth server MUST allow
  // any port at request time for loopback redirect URIs.
  get redirectUrl(): string {
    return this._redirectUrl ?? 'http://127.0.0.1/callback';
  }

  get clientMetadata(): OAuthClientMetadata {
    const meta: OAuthClientMetadata = {
      client_name: CLIENT_NAME,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
    if (this.scope && this.scope.trim().length > 0) {
      meta.scope = this.scope.trim();
    }
    return meta;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const raw = this.ctx.globalState.get<string>(this.k('client'));
    if (!raw) return undefined;
    try {
      const info = JSON.parse(raw) as OAuthClientInformationMixed & { redirect_uris?: string[] };
      // Heal stale DCR: only invalidate when registered URIs are clearly
      // incompatible (e.g. different scheme — old `vscode://` data from a
      // previous version). Loopback URIs differing only by port are
      // compatible per RFC 8252 §7.3.
      if (info.redirect_uris && !redirectUriCompatible(info.redirect_uris, this.redirectUrl)) {
        log.warn(`oauth: stale DCR for ${this.serverName} (redirect_uri mismatch), forcing re-register`);
        await this.invalidateCredentials('client');
        return undefined;
      }
      return info;
    } catch (err) {
      log.warn(`oauth: bad client info for ${this.serverName}`, err);
      return undefined;
    }
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await this.ctx.globalState.update(this.k('client'), JSON.stringify(info));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const raw = await this.ctx.secrets.get(this.k('tokens'));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as OAuthTokens;
    } catch (err) {
      log.warn(`oauth: bad tokens for ${this.serverName}`, err);
      return undefined;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.ctx.secrets.store(this.k('tokens'), JSON.stringify(tokens));
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this._allowBrowserRedirect) {
      // Background connect tried to authenticate but we don't want to open a
      // browser unless the user explicitly clicked Sign in. Skipping here makes
      // the SDK throw UnauthorizedError back to McpClient.connect(), which
      // surfaces as a "Sign in required" status in the UI.
      log.info(`oauth: suppressed browser redirect for ${this.serverName} (no active flow)`);
      return;
    }
    log.info(`oauth: opening browser for ${this.serverName}`, { url: authorizationUrl.toString() });
    await vscode.env.openExternal(vscode.Uri.parse(authorizationUrl.toString()));
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await this.ctx.secrets.store(this.k('verifier'), verifier);
  }

  async codeVerifier(): Promise<string> {
    const v = await this.ctx.secrets.get(this.k('verifier'));
    if (!v) throw new Error(`No PKCE verifier saved for "${this.serverName}" — start OAuth flow first`);
    return v;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'all' || scope === 'tokens') {
      await this.ctx.secrets.delete(this.k('tokens'));
    }
    if (scope === 'all' || scope === 'verifier') {
      await this.ctx.secrets.delete(this.k('verifier'));
    }
    if (scope === 'all' || scope === 'client') {
      await this.ctx.globalState.update(this.k('client'), undefined);
    }
  }

  /** Wipe every artefact for this server (used on server delete or auth-mode change). */
  async clearAll(): Promise<void> {
    await this.invalidateCredentials('all');
  }

  private k(kind: 'tokens' | 'verifier' | 'client'): string {
    return `devCode.mcpOAuth.${kind}.${this.serverName}`;
  }
}

function redirectUriCompatible(registered: string[], current: string): boolean {
  if (registered.includes(current)) return true;
  const currentKey = loopbackKey(current);
  if (!currentKey) return false;
  return registered.some((r) => loopbackKey(r) === currentKey);
}

function loopbackKey(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]') {
      return `${u.protocol}//${u.hostname}${u.pathname}`;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}
