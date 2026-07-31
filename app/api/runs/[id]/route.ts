// GET /api/runs/:id -> full run detail (poll target)

import { NextResponse } from "next/server";
import { jsonError, withUser } from "@/lib/api";
import { db } from "@/lib/db";

export const GET = withUser(async (user, _req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const run = await db.run.findUnique({ where: { id } });
  if (!run || run.userId !== user.id) return jsonError("not found", 404);
  return NextResponse.json({
    id: run.id,
    status: run.status,
    backend: run.backend,
    logs: run.logs,
    results: run.results,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  });
});
