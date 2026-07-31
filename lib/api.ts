import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/auth";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Wrap an authed API handler: resolves the user, maps auth failures to 401. */
export function withUser<T>(
  handler: (user: { id: string; email: string }, req: Request, ctx: T) => Promise<Response>
) {
  return async (req: Request, ctx: T): Promise<Response> => {
    try {
      const user = await requireUser();
      return await handler(user, req, ctx);
    } catch (e) {
      if (e instanceof UnauthorizedError) return jsonError("unauthorized", 401);
      console.error(e);
      return jsonError("internal error", 500);
    }
  };
}
