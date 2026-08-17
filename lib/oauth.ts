// OAuth 2.1 authorization server for MCP clients (claude.ai, Claude Desktop,
// MCP Inspector, ...). Implements what the MCP authorization spec requires:
//
//   - RFC 8414 authorization-server metadata   (/.well-known/oauth-authorization-server)
//   - RFC 9728 protected-resource metadata     (/.well-known/oauth-protected-resource)
//   - RFC 7591 dynamic client registration     (POST /api/oauth/register)
//   - authorization code grant + PKCE (S256)   (/oauth/authorize, POST /api/oauth/token)
//   - refresh tokens (rotated) + RFC 7009 revocation
//
// The "login" step is the site's existing Google sign-in (allowlisted emails
// only), so approving a client just links it to the signed-in user.

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { isAllowedEmail } from "@/lib/auth";

export const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
export const CODE_TTL_SEC = 10 * 60; // 10 minutes
export const SCOPES = ["mcp"];
const AUTH_METHODS = ["none", "client_secret_basic", "client_secret_post"] as const;

export class OAuthError extends Error {
  constructor(
    public code:
      | "invalid_request"
      | "invalid_client"
      | "invalid_grant"
      | "unauthorized_client"
      | "unsupported_grant_type"
      | "invalid_scope"
      | "invalid_client_metadata"
      | "invalid_redirect_uri"
      | "server_error",
    public description: string,
    public status = 400
  ) {
    super(description);
  }
  toJSON() {
    return { error: this.code, error_description: this.description };
  }
}

// ---------- URLs ----------

/** Public origin of this deployment (respects proxies; AUTH_URL wins if set). */
export function publicOrigin(headers: Headers): string {
  const env = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      /* fall through */
    }
  }
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto =
    headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

export const MCP_PATH = "/api/mcp";
export const AUTHORIZE_PATH = "/oauth/authorize";

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    scopes_supported: SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [...AUTH_METHODS],
    revocation_endpoint_auth_methods_supported: [...AUTH_METHODS],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${origin}/`,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "LabBench MCP",
    resource_documentation: `${origin}/`,
  };
}

/** Value for the WWW-Authenticate header on 401s from the MCP endpoint. */
export function wwwAuthenticate(origin: string, error?: string) {
  const parts = [
    `realm="labbench"`,
    `resource_metadata="${origin}/.well-known/oauth-protected-resource${MCP_PATH}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  return `Bearer ${parts.join(", ")}`;
}

// ---------- crypto helpers ----------

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

export function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== "S256") return false;
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return safeEqual(sha256(verifier), challenge);
}

// ---------- client registration (RFC 7591) ----------

function isAcceptableRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  // Loopback over http is fine for local dev tools (MCP Inspector, mcp-remote, ...).
  if (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return true;
  // Custom schemes for native apps (e.g. claude://, cursor://).
  return u.protocol !== "http:" && u.protocol !== "javascript:" && u.protocol !== "data:";
}

export async function registerClient(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new OAuthError("invalid_client_metadata", "request body must be a JSON object");
  }
  const meta = body as Record<string, unknown>;

  const redirectUris = meta.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((u) => typeof u === "string")) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must be a non-empty array of strings");
  }
  for (const uri of redirectUris as string[]) {
    if (!isAcceptableRedirectUri(uri)) {
      throw new OAuthError("invalid_redirect_uri", `unacceptable redirect_uri: ${uri}`);
    }
  }

  const grantTypes = Array.isArray(meta.grant_types) ? (meta.grant_types as unknown[]) : ["authorization_code"];
  if (grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    throw new OAuthError("invalid_client_metadata", "only authorization_code and refresh_token grants are supported");
  }
  const responseTypes = Array.isArray(meta.response_types) ? (meta.response_types as unknown[]) : ["code"];
  if (responseTypes.some((r) => r !== "code")) {
    throw new OAuthError("invalid_client_metadata", "only the code response_type is supported");
  }

  const requestedAuth = typeof meta.token_endpoint_auth_method === "string" ? meta.token_endpoint_auth_method : "client_secret_basic";
  if (!(AUTH_METHODS as readonly string[]).includes(requestedAuth)) {
    throw new OAuthError("invalid_client_metadata", `unsupported token_endpoint_auth_method: ${requestedAuth}`);
  }

  const clientId = randomToken("lbc", 16);
  const secret = requestedAuth === "none" ? null : randomToken("lbs", 32);
  const name = typeof meta.client_name === "string" ? meta.client_name.slice(0, 200) : null;

  await db.oAuthClient.create({
    data: {
      id: clientId,
      secretHash: secret ? sha256(secret) : null,
      name,
      redirectUris: redirectUris as string[],
      tokenEndpointAuthMethod: requestedAuth,
      metadata: meta as object,
    },
  });

  return {
    client_id: clientId,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name ?? undefined,
    redirect_uris: redirectUris,
    grant_types: grantTypes.length ? grantTypes : ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: requestedAuth,
    scope: SCOPES.join(" "),
    // echo harmless informational fields back
    ...(typeof meta.client_uri === "string" ? { client_uri: meta.client_uri } : {}),
    ...(typeof meta.logo_uri === "string" ? { logo_uri: meta.logo_uri } : {}),
  };
}

// ---------- authorize ----------

export interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
  state?: string;
  scope?: string;
  resource?: string;
}

/**
 * Validates an authorization request. Returns the client + normalized params.
 * Throws OAuthError. When `redirectable` is true the caller may relay the
 * error to the redirect_uri; when false (bad client/redirect) it must render.
 */
export async function validateAuthorizeRequest(raw: Record<string, string | undefined>) {
  const clientId = raw.client_id?.trim();
  if (!clientId) throw Object.assign(new OAuthError("invalid_request", "missing client_id"), { redirectable: false });
  const client = await db.oAuthClient.findUnique({ where: { id: clientId } });
  if (!client) throw Object.assign(new OAuthError("invalid_client", "unknown client_id", 400), { redirectable: false });

  let redirectUri = raw.redirect_uri?.trim();
  if (!redirectUri) {
    if (client.redirectUris.length === 1) redirectUri = client.redirectUris[0];
    else throw Object.assign(new OAuthError("invalid_request", "missing redirect_uri"), { redirectable: false });
  }
  if (!client.redirectUris.includes(redirectUri)) {
    throw Object.assign(new OAuthError("invalid_request", "redirect_uri is not registered for this client"), { redirectable: false });
  }

  const params: AuthorizeParams = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: raw.response_type ?? "",
    code_challenge: raw.code_challenge ?? "",
    code_challenge_method: raw.code_challenge_method ?? "",
    state: raw.state,
    scope: raw.scope,
    resource: raw.resource,
  };
  if (params.response_type !== "code") {
    throw Object.assign(new OAuthError("invalid_request", "response_type must be 'code'"), { redirectable: true });
  }
  if (!params.code_challenge) {
    throw Object.assign(new OAuthError("invalid_request", "code_challenge is required (PKCE)"), { redirectable: true });
  }
  if (params.code_challenge_method !== "S256") {
    throw Object.assign(new OAuthError("invalid_request", "code_challenge_method must be S256"), { redirectable: true });
  }
  if (params.scope) {
    const unknown = params.scope.split(/\s+/).filter((s) => s && !SCOPES.includes(s));
    if (unknown.length) throw Object.assign(new OAuthError("invalid_scope", `unknown scope: ${unknown.join(" ")}`), { redirectable: true });
  }
  return { client, params };
}

/** Mints an authorization code bound to (client, user, redirect_uri, PKCE). */
export async function issueAuthorizationCode(userId: string, p: AuthorizeParams): Promise<string> {
  const code = randomToken("lbac", 32);
  await db.oAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId: p.client_id,
      userId,
      redirectUri: p.redirect_uri,
      codeChallenge: p.code_challenge,
      codeChallengeMethod: p.code_challenge_method,
      scope: p.scope || SCOPES.join(" "),
      resource: p.resource || null,
      expiresAt: new Date(Date.now() + CODE_TTL_SEC * 1000),
    },
  });
  return code;
}

export function redirectWith(redirectUri: string, query: Record<string, string | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

// ---------- token endpoint ----------

/** Parses form-encoded or JSON bodies into a flat string map. */
export async function parseBody(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  if (ct.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(j)) if (typeof v === "string") out[k] = v;
    return out;
  }
  const text = await req.text();
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

/** Authenticates the client via HTTP Basic or body params (or none for public clients). */
export async function authenticateClient(req: Request, body: Record<string, string>) {
  let clientId = body.client_id;
  let clientSecret = body.client_secret;
  const authz = req.headers.get("authorization") ?? "";
  if (/^Basic\s+/i.test(authz)) {
    const decoded = Buffer.from(authz.replace(/^Basic\s+/i, ""), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx >= 0) {
      clientId = decodeURIComponent(decoded.slice(0, idx));
      clientSecret = decodeURIComponent(decoded.slice(idx + 1));
    }
  }
  if (!clientId) throw new OAuthError("invalid_client", "missing client_id", 401);
  const client = await db.oAuthClient.findUnique({ where: { id: clientId } });
  if (!client) throw new OAuthError("invalid_client", "unknown client", 401);
  if (client.secretHash) {
    if (!clientSecret || !safeEqual(sha256(clientSecret), client.secretHash)) {
      throw new OAuthError("invalid_client", "client authentication failed", 401);
    }
  }
  return client;
}

function tokenResponse(access: string, refresh: string | null, scope: string | null) {
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    ...(refresh ? { refresh_token: refresh } : {}),
    scope: scope ?? SCOPES.join(" "),
  };
}

export async function exchangeAuthorizationCode(clientId: string, body: Record<string, string>) {
  const { code, redirect_uri: redirectUri, code_verifier: verifier } = body;
  if (!code) throw new OAuthError("invalid_request", "missing code");
  if (!verifier) throw new OAuthError("invalid_request", "missing code_verifier");

  const row = await db.oAuthCode.findUnique({ where: { codeHash: sha256(code) } });
  if (!row || row.clientId !== clientId) throw new OAuthError("invalid_grant", "invalid authorization code");
  if (row.usedAt) {
    // Replay: revoke everything minted from this code's client for this user (OAuth 2.1 §4.1.2).
    await db.oAuthToken.updateMany({ where: { clientId, userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw new OAuthError("invalid_grant", "authorization code already used");
  }
  if (row.expiresAt < new Date()) throw new OAuthError("invalid_grant", "authorization code expired");
  if (redirectUri && redirectUri !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri mismatch");
  if (!verifyPkce(verifier, row.codeChallenge, row.codeChallengeMethod)) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }

  const access = randomToken("lbat", 32);
  const refresh = randomToken("lbrt", 32);
  const now = Date.now();
  await db.$transaction([
    db.oAuthCode.update({ where: { codeHash: row.codeHash }, data: { usedAt: new Date() } }),
    db.oAuthToken.create({
      data: {
        accessTokenHash: sha256(access),
        refreshTokenHash: sha256(refresh),
        clientId,
        userId: row.userId,
        scope: row.scope,
        resource: row.resource,
        accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_SEC * 1000),
        refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SEC * 1000),
      },
    }),
  ]);
  return tokenResponse(access, refresh, row.scope);
}

export async function refreshAccessToken(clientId: string, body: Record<string, string>) {
  const refresh = body.refresh_token;
  if (!refresh) throw new OAuthError("invalid_request", "missing refresh_token");
  const row = await db.oAuthToken.findUnique({ where: { refreshTokenHash: sha256(refresh) } });
  if (!row || row.clientId !== clientId || row.revokedAt) throw new OAuthError("invalid_grant", "invalid refresh token");
  if (!row.refreshExpiresAt || row.refreshExpiresAt < new Date()) throw new OAuthError("invalid_grant", "refresh token expired");

  // Rotate both tokens in place; the old pair stops working immediately.
  const access = randomToken("lbat", 32);
  const newRefresh = randomToken("lbrt", 32);
  await db.oAuthToken.update({
    where: { id: row.id },
    data: {
      accessTokenHash: sha256(access),
      refreshTokenHash: sha256(newRefresh),
      accessExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000),
    },
  });
  return tokenResponse(access, newRefresh, row.scope);
}

export async function revokeToken(clientId: string, token: string) {
  const h = sha256(token);
  await db.oAuthToken.updateMany({
    where: { clientId, revokedAt: null, OR: [{ accessTokenHash: h }, { refreshTokenHash: h }] },
    data: { revokedAt: new Date() },
  });
}

// ---------- resource server side ----------

/** Resolves an OAuth access token to its user, or null if invalid/expired/revoked. */
export async function verifyAccessToken(token: string): Promise<{ userId: string; clientId: string; scope: string | null } | null> {
  if (!token.startsWith("lbat_")) return null;
  const row = await db.oAuthToken.findUnique({
    where: { accessTokenHash: sha256(token) },
    include: { user: { select: { email: true } } },
  });
  if (!row || row.revokedAt || row.accessExpiresAt < new Date()) return null;
  // Allowlist is enforced at every use, so removing an email cuts off tokens too.
  if (!isAllowedEmail(row.user.email)) return null;
  return { userId: row.userId, clientId: row.clientId, scope: row.scope };
}

// ---------- CORS (browser-based MCP clients / inspectors) ----------

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...CORS_HEADERS,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function oauthErrorResponse(e: unknown): Response {
  if (e instanceof OAuthError) return json(e.toJSON(), { status: e.status });
  console.error("oauth error", e);
  return json({ error: "server_error", error_description: "internal error" }, { status: 500 });
}
