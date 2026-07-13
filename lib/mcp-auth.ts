type JWTPayload = Record<string, unknown> & {
  aud?: string | string[];
  exp?: number;
  iat?: number;
  iss?: string;
  nbf?: number;
  permissions?: unknown;
  scope?: unknown;
  sub?: string;
};

export const MCP_READ_SCOPE = "org:read";
export const MCP_WRITE_SCOPE = "org:write";
export const MCP_SCOPES = [MCP_READ_SCOPE, MCP_WRITE_SCOPE] as const;

type RuntimeBindings = {
  AUTH0_ISSUER?: string;
  JWT_AUDIENCE?: string;
  MCP_RESOURCE_URL?: string;
};

export type AuthenticatedPrincipal = {
  subject: string;
  scopes: Set<string>;
  claims: JWTPayload;
};

export type AuthorizationResult =
  | { ok: true; principal: AuthenticatedPrincipal }
  | { ok: false; response: Response };

type JsonWebKeyWithKid = JsonWebKey & { kid?: string; use?: string };

const jwksCache = new Map<string, { expiresAt: number; keys: JsonWebKeyWithKid[] }>();

function bindings(): RuntimeBindings {
  return process.env as RuntimeBindings;
}

function normalizeIssuer(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname.replace(/\/?$/, "/")}`;
  } catch {
    return null;
  }
}

export function getMcpResourceUrl(request: Request): string {
  const configured = bindings().MCP_RESOURCE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return `${new URL(request.url).origin}/mcp`;
}

export function getAuthConfiguration(request: Request) {
  const issuer = normalizeIssuer(bindings().AUTH0_ISSUER);
  const resource = getMcpResourceUrl(request);
  const audience = bindings().JWT_AUDIENCE?.trim() || resource;
  return { issuer, resource, audience };
}

export function protectedResourceMetadata(request: Request) {
  const { issuer, resource } = getAuthConfiguration(request);
  if (!issuer) return null;

  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${new URL(request.url).origin}/`,
  };
}

function metadataUrl(request: Request): string {
  return `${new URL(request.url).origin}/.well-known/oauth-protected-resource`;
}

function challenge(request: Request, scope: string, error?: string, description?: string): string {
  const parts = [
    `Bearer resource_metadata="${metadataUrl(request)}"`,
    `scope="${scope}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/["\\]/g, "")}"`);
  return parts.join(", ");
}

function unauthorized(request: Request, scope: string, error: string, description: string, status = 401) {
  return Response.json(
    { error, error_description: description },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": challenge(request, scope, error, description),
      },
    },
  );
}

function tokenScopes(payload: JWTPayload): Set<string> {
  const scopes = new Set<string>();
  if (typeof payload.scope === "string") {
    for (const scope of payload.scope.split(/\s+/)) if (scope) scopes.add(scope);
  }

  const permissions = payload.permissions;
  if (Array.isArray(permissions)) {
    for (const permission of permissions) {
      if (typeof permission === "string") scopes.add(permission);
    }
  }
  return scopes;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

async function loadJwks(issuer: string, forceRefresh = false): Promise<JsonWebKeyWithKid[]> {
  const cached = jwksCache.get(issuer);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(new URL(".well-known/jwks.json", issuer), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("JWKS endpoint is unavailable.");
  const body = await response.json() as { keys?: JsonWebKeyWithKid[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) throw new Error("JWKS is empty.");
  jwksCache.set(issuer, { expiresAt: Date.now() + 5 * 60 * 1000, keys: body.keys });
  return body.keys;
}

function audienceMatches(claim: string | string[] | undefined, expected: string): boolean {
  return typeof claim === "string" ? claim === expected : Array.isArray(claim) && claim.includes(expected);
}

async function verifyAccessToken(token: string, issuer: string, audience: string): Promise<JWTPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT.");
  const header = decodeJson<{ alg?: string; kid?: string; typ?: string }>(parts[0]);
  const payload = decodeJson<JWTPayload>(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported JWT algorithm.");

  let keys = await loadJwks(issuer);
  let jwk = keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!jwk) {
    keys = await loadJwks(issuer, true);
    jwk = keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
  }
  if (!jwk) throw new Error("Signing key was not found.");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!signatureValid) throw new Error("JWT signature is invalid.");

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== issuer) throw new Error("JWT issuer is invalid.");
  if (!audienceMatches(payload.aud, audience)) throw new Error("JWT audience is invalid.");
  if (typeof payload.exp !== "number" || payload.exp <= now - 30) throw new Error("JWT has expired.");
  if (typeof payload.nbf === "number" && payload.nbf > now + 30) throw new Error("JWT is not active yet.");
  return payload;
}

export async function authorizeMcpRequest(
  request: Request,
  requiredScopes: readonly string[] = [MCP_READ_SCOPE],
): Promise<AuthorizationResult> {
  const requiredScope = requiredScopes.join(" ");
  const { issuer, audience } = getAuthConfiguration(request);
  if (!issuer) {
    return {
      ok: false,
      response: Response.json(
        { error: "server_configuration_error", error_description: "AUTH0_ISSUER is not configured." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, response: unauthorized(request, requiredScope, "invalid_token", "Bearer access token is required.") };
  }

  try {
    const payload = await verifyAccessToken(match[1], issuer, audience);
    const scopes = tokenScopes(payload);
    const missing = requiredScopes.filter((scope) => !scopes.has(scope));
    if (missing.length > 0) {
      return {
        ok: false,
        response: unauthorized(
          request,
          requiredScope,
          "insufficient_scope",
          `Required scope is missing: ${missing.join(" ")}`,
          403,
        ),
      };
    }

    if (!payload.sub) {
      return { ok: false, response: unauthorized(request, requiredScope, "invalid_token", "Token subject is missing.") };
    }

    return { ok: true, principal: { subject: payload.sub, scopes, claims: payload } };
  } catch {
    return { ok: false, response: unauthorized(request, requiredScope, "invalid_token", "Access token validation failed.") };
  }
}

export function withMcpCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "authorization, content-type, accept, mcp-session-id, mcp-protocol-version");
  headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
