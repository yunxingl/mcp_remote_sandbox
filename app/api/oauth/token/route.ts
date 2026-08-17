// OAuth 2.1 token endpoint: authorization_code (with PKCE) and refresh_token grants.
import {
  OAuthError,
  authenticateClient,
  exchangeAuthorizationCode,
  json,
  oauthErrorResponse,
  parseBody,
  preflight,
  refreshAccessToken,
} from "@/lib/oauth";

export async function POST(req: Request) {
  try {
    const body = await parseBody(req);
    const client = await authenticateClient(req, body);
    switch (body.grant_type) {
      case "authorization_code":
        return json(await exchangeAuthorizationCode(client.id, body));
      case "refresh_token":
        return json(await refreshAccessToken(client.id, body));
      default:
        throw new OAuthError("unsupported_grant_type", `unsupported grant_type: ${body.grant_type ?? "(missing)"}`);
    }
  } catch (e) {
    return oauthErrorResponse(e);
  }
}
export async function OPTIONS() {
  return preflight();
}
