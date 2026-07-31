// POST /api/runs { key, files }  -> create run, execute in background
// GET  /api/runs?key=...&limit=N -> recent runs for a problem

import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { jsonError, withUser } from "@/lib/api";
import { db } from "@/lib/db";
import { getProblemByKey } from "@/lib/problems";
import { executeRun, resolveBackend } from "@/lib/runner";

const PostBody = z.object({
  key: z.string().min(3),
  files: z.record(z.string(), z.string()),
});

export const POST = withUser(async (user, req) => {
  const parsed = PostBody.safeParse(await req.json());
  if (!parsed.success) return jsonError("bad request", 400);
  const { key, files } = parsed.data;
  const problem = await getProblemByKey(key);
  if (!problem) return jsonError("problem not found", 404);

  // Save the workspace too, so run + save stay consistent.
  await db.workspace.upsert({
    where: { userId_problemKey: { userId: user.id, problemKey: key } },
    create: { userId: user.id, problemKey: key, files },
    update: { files },
  });

  const run = await db.run.create({
    data: {
      userId: user.id,
      problemKey: key,
      status: "queued",
      backend: resolveBackend(problem.machine).name,
      machine: problem.machine as unknown as object,
      files,
    },
  });

  after(() => executeRun(run.id));
  return NextResponse.json({ id: run.id, status: run.status });
});

export const GET = withUser(async (user, req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key) return jsonError("missing key", 400);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 10), 50);
  const runs = await db.run.findMany({
    where: { userId: user.id, problemKey: key },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, status: true, backend: true, results: true, createdAt: true, finishedAt: true },
  });
  return NextResponse.json({ runs });
});
