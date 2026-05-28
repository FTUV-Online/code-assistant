import * as http from 'http';
import { AddressInfo } from 'net';
import * as log from '../util/logger';

export type OAuthListener = {
  port: number;
  redirectUrl: string;
  /** Resolves with the authorization code, or rejects on error/timeout/cancel. */
  codePromise: Promise<string>;
  /** Stop accepting connections and close the server. Safe to call multiple times. */
  close: () => void;
};

const CALLBACK_PATH = '/callback';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Spin up an ephemeral HTTP server on 127.0.0.1 that captures the OAuth
 * authorization-code redirect. The browser is redirected to `http://127.0.0.1:<port>/callback`,
 * we serve a friendly HTML page, then resolve the code back to the caller.
 *
 * Loopback-only (127.0.0.1) — no external interface is bound, so this does not
 * trigger Windows Firewall and is not reachable from the network.
 */
export async function startOAuthListener(
  serverName: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<OAuthListener> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  let settled = false;
  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    fn();
  };

  const server = http.createServer((req, res) => {
    try {
      // Reject anything that isn't a GET on the callback path.
      const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1`);
      if (req.method !== 'GET' || reqUrl.pathname !== CALLBACK_PATH) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');
      const errorDesc = reqUrl.searchParams.get('error_description');

      if (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(failurePage(serverName, errorDesc ?? error));
        settle(() => rejectCode(new Error(`OAuth error: ${errorDesc ?? error}`)));
        return;
      }
      if (!code) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(failurePage(serverName, 'Missing authorization code.'));
        settle(() => rejectCode(new Error('OAuth callback missing code')));
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(successPage(serverName));
      settle(() => resolveCode(code));
    } catch (err) {
      log.error('oauth listener: request handler error', err);
      try {
        res.statusCode = 500;
        res.end('Internal Server Error');
      } catch {
        /* ignore */
      }
      settle(() => rejectCode(err instanceof Error ? err : new Error(String(err))));
    }
  });

  const timeoutHandle = setTimeout(() => {
    settle(() => rejectCode(new Error(`OAuth flow timed out after ${Math.round(timeoutMs / 1000)}s`)));
    server.close();
  }, timeoutMs);

  // Tear down server once we have a result (success or failure).
  void codePromise.finally(() => {
    clearTimeout(timeoutHandle);
    server.close();
  }).catch(() => {/* swallow — caller observes via codePromise */});

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const port = addr.port;
  const redirectUrl = `http://127.0.0.1:${port}/callback`;
  log.info(`oauth listener: listening for ${serverName}`, { redirectUrl });

  return {
    port,
    redirectUrl,
    codePromise,
    close: () => {
      clearTimeout(timeoutHandle);
      settle(() => rejectCode(new Error('OAuth flow cancelled')));
      server.close();
    },
  };
}

function successPage(serverName: string): string {
  const safeName = escapeHtml(serverName);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Sign-in complete</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #0d1117; color: #c9d1d9; display: flex; align-items: center;
         justify-content: center; min-height: 100vh; margin: 0; }
  .card { max-width: 420px; padding: 32px; background: #161b22; border-radius: 8px;
          border: 1px solid #30363d; text-align: center; }
  h1 { margin: 0 0 12px 0; font-size: 20px; }
  p  { margin: 6px 0; opacity: 0.85; }
  .check { font-size: 40px; color: #3fb950; margin-bottom: 8px; }
</style></head>
<body><div class="card">
  <div class="check">✓</div>
  <h1>Signed in to ${safeName}</h1>
  <p>You can close this window and return to VS Code.</p>
</div>
<script>setTimeout(function(){ try { window.close(); } catch(e){} }, 800);</script>
</body></html>`;
}

function failurePage(serverName: string, message: string): string {
  const safeName = escapeHtml(serverName);
  const safeMsg = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Sign-in failed</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #0d1117; color: #c9d1d9; display: flex; align-items: center;
         justify-content: center; min-height: 100vh; margin: 0; }
  .card { max-width: 480px; padding: 32px; background: #161b22; border-radius: 8px;
          border: 1px solid #f8514955; text-align: center; }
  h1 { margin: 0 0 12px 0; font-size: 20px; color: #f85149; }
  pre { margin: 12px 0 0 0; padding: 12px; background: #0d1117; border-radius: 6px;
        text-align: left; white-space: pre-wrap; word-break: break-word; font-size: 12px; }
</style></head>
<body><div class="card">
  <h1>Sign-in to ${safeName} failed</h1>
  <p>You can close this window and return to VS Code.</p>
  <pre>${safeMsg}</pre>
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
