// RFC 7009 — token revocation. Always 200 for well-formed requests.
import { OAuthError, authenticateClient, json, oauthErrorResponse, parseBody, preflight, revokeToken } from "@/lib/oauth";

export async function POST(req: Request) {
  try {
    const body = await parseBody(req);
    if (!body.token) throw new OAuthError("invalid_request", "missing token");
    const client = await authenticateClient(req, body);
    await revokeToken(client.id, body.token);
    return json({});
  } catch (e) {
    return oauthErrorResponse(e);
  }
}
export async function OPTIONS() {
  return preflight();
}
