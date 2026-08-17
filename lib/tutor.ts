// The in-site tutor: per-problem chat backed by OpenRouter (OpenAI-compatible API).
// MCP hints posted from Claude Code land in the same thread (role "mcp").

import { db } from "@/lib/db";
import { ProblemDetail, FileMap, TestResults } from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";

export function tutorConfigured(): boolean {
  return !!process.env.OPENROUTER_KEY;
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

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function openrouterChat(messages: ChatMessage[]): Promise<string> {
  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      // Optional attribution headers shown on openrouter.ai rankings.
      "HTTP-Referer": process.env.NEXTAUTH_URL || process.env.AUTH_URL || "https://labbench.local",
      "X-Title": "LabBench",
    },
    // Generous budget: reasoning models (DeepSeek, o-series, etc.) spend tokens thinking first.
    body: JSON.stringify({ model: MODEL, max_tokens: 4096, messages }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`OpenRouter ${resp.status}: ${body.slice(0, 500)}`);
  }
  const data = (await resp.json()) as {
    choices?: { message?: { content?: string | { type: string; text?: string }[] } }[];
    error?: { message?: string };
  };
  if (data.error) throw new Error(`OpenRouter: ${data.error.message}`);
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
  }
  return "";
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
      "Tutor chat is not configured (set OPENROUTER_KEY). " +
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
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt(problem, files, lastRun ? {
        status: lastRun.status,
        logs: lastRun.logs,
        results: (lastRun.results as TestResults | null) ?? null,
      } : undefined),
    },
    ...history.map((m): ChatMessage => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.role === "mcp" ? `[hint sent from Claude Code via MCP]\n${m.content}` : m.content,
    })),
  ];

  const text =
    (await openrouterChat(messages)).trim() ||
    "(The model returned an empty reply — try again or pick a different OPENROUTER_MODEL.)";
  await db.chatMessage.create({ data: { userId, problemKey: key, role: "assistant", content: text } });
  return text;
}
