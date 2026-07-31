// GET  /api/chat?key=...           -> thread for this problem
// POST /api/chat { key, message }  -> send message, get tutor reply

import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, withUser } from "@/lib/api";
import { db } from "@/lib/db";
import { getProblemByKey } from "@/lib/problems";
import { tutorReply } from "@/lib/tutor";

export const GET = withUser(async (user, req) => {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return jsonError("missing key", 400);
  const messages = await db.chatMessage.findMany({
    where: { userId: user.id, problemKey: key },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return NextResponse.json({ messages });
});

const PostBody = z.object({
  key: z.string().min(3),
  message: z.string().min(1).max(20_000),
});

export const POST = withUser(async (user, req) => {
  const parsed = PostBody.safeParse(await req.json());
  if (!parsed.success) return jsonError("bad request", 400);
  const problem = await getProblemByKey(parsed.data.key);
  if (!problem) return jsonError("problem not found", 404);
  const reply = await tutorReply(user.id, problem, parsed.data.message);
  return NextResponse.json({ reply });
});
