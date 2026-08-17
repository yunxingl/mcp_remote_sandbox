// RFC 7591 — dynamic client registration. Open registration: MCP clients such
// as claude.ai register themselves before the user approves them.
import { json, oauthErrorResponse, preflight, registerClient } from "@/lib/oauth";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    return json(await registerClient(body), { status: 201 });
  } catch (e) {
    return oauthErrorResponse(e);
  }
}
export async function OPTIONS() {
  return preflight();
}
