// The in-site tutor: per-problem chat backed by the Anthropic API.
// MCP hints posted from Claude Code land in the same thread (role "mcp").

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { ProblemDetail, FileMap, TestResults } from "@/lib/types";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

export function tutorConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function systemPrompt(problem: ProblemDetail, files: FileMap, lastRun?: { status: string; logs: string; results: TestResults | null }) {
  const fileDump = Object.entries(files)
    .map(([p, c]) => `--- ${p} ---\n${c}`)
    .join("\n\n");
  return `You are a tutor on LabBench, a platform for learning ML and systems by implementation.
The student is working on the problem below. Be a great TA: give hints, explain concepts,
point at bugs — but do not paste complete solutions unless the student explicitly insists.

# Problem: ${problem.title}

${problem.statementMd}

# Student's current files

${fileDump || "(no files yet)"}

${lastRun ? `# Latest test run (${lastRun.status})\n\n${lastRun.logs.slice(0, 8000)}` : ""}`;
}

export async function tutorReply(
  userId: string,
  problem: ProblemDetail,
  userMessage: string
): Promise<string> {
  const key = problem.key;
  await db.chatMessage.create({
    data: { userId, problemKey: key, role: "user", content: userMessage },
  });

  if (!tutorConfigured()) {
    const msg =
      "Tutor chat is not configured (set ANTHROPIC_API_KEY). " +
      "You can still get help through the MCP integration from Claude Code.";
    await db.chatMessage.create({ data: { userId, problemKey: key, role: "assistant", content: msg } });
    return msg;
  }

  const [history, ws, lastRun] = await Promise.all([
    db.chatMessage.findMany({
      where: { userId, problemKey: key },
      orderBy: { createdAt: "asc" },
      take: 40,
    }),
    db.workspace.findUnique({ where: { userId_problemKey: { userId, problemKey: key } } }),
    db.run.findFirst({
      where: { userId, problemKey: key, finishedAt: { not: null } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const files = (ws?.files as FileMap | undefined) ?? problem.starter;
  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.role === "mcp" ? `[hint sent from Claude Code via MCP]\n${m.content}` : m.content,
  }));

  const client = new Anthropic();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt(problem, files, lastRun ? {
      status: lastRun.status,
      logs: lastRun.logs,
      results: (lastRun.results as TestResults | null) ?? null,
    } : undefined),
    messages,
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  await db.chatMessage.create({ data: { userId, problemKey: key, role: "assistant", content: text } });
  return text;
}
