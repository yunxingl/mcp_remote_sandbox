// RFC 9728 — protected resource metadata for /api/mcp (root form).
import { json, preflight, protectedResourceMetadata, publicOrigin } from "@/lib/oauth";

export async function GET(req: Request) {
  return json(protectedResourceMetadata(publicOrigin(req.headers)), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
export async function OPTIONS() {
  return preflight();
}
