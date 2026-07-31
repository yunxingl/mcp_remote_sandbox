// GET  /api/workspace?key=<course>/<slug>   -> { files } (saved or starter)
// PUT  /api/workspace  { key, files }       -> save editor state

import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, withUser } from "@/lib/api";
import { db } from "@/lib/db";
import { getProblemByKey } from "@/lib/problems";
import { FileMap } from "@/lib/types";

export const GET = withUser(async (user, req) => {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return jsonError("missing key", 400);
  const problem = await getProblemByKey(key);
  if (!problem) return jsonError("problem not found", 404);
  const ws = await db.workspace.findUnique({
    where: { userId_problemKey: { userId: user.id, problemKey: key } },
  });
  const files = (ws?.files as FileMap | undefined) ?? problem.starter;
  return NextResponse.json({ files, saved: !!ws });
});

const PutBody = z.object({
  key: z.string().min(3),
  files: z.record(z.string(), z.string()),
});

export const PUT = withUser(async (user, req) => {
  const parsed = PutBody.safeParse(await req.json());
  if (!parsed.success) return jsonError("bad request", 400);
  const { key, files } = parsed.data;
  if (!(await getProblemByKey(key))) return jsonError("problem not found", 404);
  await db.workspace.upsert({
    where: { userId_problemKey: { userId: user.id, problemKey: key } },
    create: { userId: user.id, problemKey: key, files },
    update: { files },
  });
  return NextResponse.json({ ok: true });
});
