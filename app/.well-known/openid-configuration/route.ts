// RFC 8414 — OAuth authorization server metadata (used by MCP clients).
import { authorizationServerMetadata, json, preflight, publicOrigin } from "@/lib/oauth";

export async function GET(req: Request) {
  return json(authorizationServerMetadata(publicOrigin(req.headers)), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
export async function OPTIONS() {
  return preflight();
}
