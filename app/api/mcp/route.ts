// Shared MCP endpoint (Streamable HTTP, stateless JSON mode).
//
// Two ways in:
//   1. Static token (Claude Code, scripts):
//        claude mcp add --transport http labbench https://<your-site>/api/mcp \
//          --header "Authorization: Bearer $MCP_TOKEN"
//   2. OAuth 2.1 (claude.ai, Claude Desktop, MCP Inspector, ...): just give the
//      client the URL; it discovers /.well-known/oauth-*, registers, and sends
//      the user through /oauth/authorize (Google login + consent).
//
// Implements the subset of MCP that stateless tool servers need:
// initialize, ping, tools/list, tools/call. Notifications get 202.

import { NextResponse } from "next/server";
import { callTool, McpContext, McpToolError, tools } from "@/lib/mcp";
import { CORS_HEADERS, preflight, publicOrigin, safeEqual, verifyAccessToken, wwwAuthenticate } from "@/lib/oauth";

export const maxDuration = 300; // allow slow sandbox runs via run_tests

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

/** Returns the caller context, or null if the bearer token is missing/invalid. */
async function authenticate(req: Request): Promise<McpContext | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  const token = m[1].trim();
  const staticToken = process.env.MCP_TOKEN;
  if (staticToken && safeEqual(token, staticToken)) return {}; // acts as site owner
  const oauth = await verifyAccessToken(token);
  return oauth ? { userId: oauth.userId } : null;
}

async function handleMessage(msg: JsonRpcRequest, ctx: McpContext): Promise<object | null> {
  const id = msg.id ?? null;
  // Notifications (no id) get no response body.
  if (msg.id === undefined || msg.method.startsWith("notifications/")) return null;

  switch (msg.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "labbench", version: "0.1.0" },
        instructions:
          "LabBench: a personal platform for learning ML & systems by implementation. " +
          "Use list_problems/get_problem to see coursework, get_workspace/get_run to inspect the student's code and test results, " +
          "post_hint to leave help in the site's chat sidebar, run_tests to execute the test suite in a sandbox, " +
          "assign_task to assign new projects (they appear on the student's dashboard), and update_task to revise one you assigned.",
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: Object.entries(tools).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = msg.params?.arguments;
      try {
        const result = await callTool(name, args, ctx);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (e) {
        if (e instanceof McpToolError) {
          return rpcResult(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
        }
        console.error("mcp tool error", e);
        return rpcResult(id, {
          content: [{ type: "text", text: `Error: internal failure running ${name}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  const ctx = await authenticate(req);
  if (!ctx) {
    const hasHeader = !!req.headers.get("authorization");
    return NextResponse.json(rpcError(null, -32001, "unauthorized"), {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        "WWW-Authenticate": wwwAuthenticate(publicOrigin(req.headers), hasHeader ? "invalid_token" : undefined),
      },
    });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "parse error"), { status: 400 });
  }

  const messages = Array.isArray(body) ? (body as JsonRpcRequest[]) : [body as JsonRpcRequest];
  const responses = (await Promise.all(messages.map((m) => handleMessage(m, ctx)))).filter((r) => r !== null);

  if (responses.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
  const payload = Array.isArray(body) ? responses : responses[0];
  return NextResponse.json(payload, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return preflight();
}

// No server-initiated stream in stateless mode.
export async function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, DELETE" } });
}

// Session teardown is a no-op for a stateless server.
export async function DELETE() {
  return new Response(null, { status: 200 });
}
