// MCP tool definitions + dispatch for the shared /api/mcp endpoint.
//
// One MCP server for the whole site: Claude Code connects once and can read
// any problem, inspect the student's workspace and runs, drop hints into the
// per-problem chat, and assign brand-new tasks (which appear under the
// "Assigned by Claude" course).
//
// Auth (see app/api/mcp/route.ts): either the static MCP_TOKEN — in which case
// tools act on behalf of the site owner, the first email in ALLOWED_EMAILS — or
// an OAuth access token, in which case they act as the user who approved it.

import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeMachine } from "@/lib/content";
import { getProblemByKey, listCourses } from "@/lib/problems";
import { DEFAULT_MACHINE, FileMap, MachineSpec } from "@/lib/types";
import { executeRun, resolveBackend } from "@/lib/runner";

export class McpToolError extends Error {}

/** Per-request context: who the caller is acting as (set by the route). */
export interface McpContext {
  userId?: string;
}

/** The user MCP acts as: the OAuth user if present, else the first ALLOWED_EMAILS entry. */
async function mcpUser(ctx: McpContext = {}) {
  if (ctx.userId) {
    const u = await db.user.findUnique({ where: { id: ctx.userId } });
    if (!u) throw new McpToolError("The user this token belongs to no longer exists.");
    return u;
  }
  const email = (process.env.ALLOWED_EMAILS ?? "").split(",")[0]?.trim().toLowerCase();
  if (!email) throw new McpToolError("ALLOWED_EMAILS is not configured on the server.");
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    throw new McpToolError(
      `No user with email ${email} exists yet — sign in to the site once with Google first.`
    );
  }
  return user;
}

const FileMapSchema = z.record(z.string(), z.string());

const MachineSchema = z
  .object({
    backend: z.enum(["auto", "local", "modal"]).optional(),
    image: z.string().optional(),
    gpu: z.string().optional(),
    cpu: z.number().optional(),
    memoryMb: z.number().optional(),
    pip: z.array(z.string()).optional(),
    timeoutSec: z.number().optional(),
  })
  .optional();

interface ToolDef {
  description: string;
  schema: z.ZodTypeAny;
  inputSchema: object; // JSON schema advertised over MCP
  handler: (args: unknown, ctx: McpContext) => Promise<unknown>;
}

const str = (desc: string) => ({ type: "string", description: desc });
const filesJson = (desc: string) => ({
  type: "object",
  description: desc,
  additionalProperties: { type: "string" },
});

export const tools: Record<string, ToolDef> = {
  list_problems: {
    description:
      "List all courses and problems on the site, including tasks previously assigned via assign_task.",
    schema: z.object({}).optional(),
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, ctx) => {
      const user = await mcpUser(ctx);
      const courses = await listCourses(user.id);
      return courses.map((c) => ({
        course: c.slug,
        title: c.title,
        problems: c.problems.map((p) => ({ key: p.key, title: p.title, difficulty: p.difficulty, tags: p.tags })),
      }));
    },
  },

  get_problem: {
    description:
      "Fetch a problem's full statement (markdown), starter files, and machine spec. key is '<course>/<slug>'.",
    schema: z.object({ key: z.string() }),
    inputSchema: {
      type: "object",
      properties: { key: str("Problem key, e.g. 'cs336-mini/bpe-tokenizer'") },
      required: ["key"],
    },
    handler: async (args, ctx) => {
      const { key } = args as { key: string };
      const p = await getProblemByKey(key);
      if (!p) throw new McpToolError(`problem not found: ${key}`);
      return {
        key: p.key,
        title: p.title,
        difficulty: p.difficulty,
        tags: p.tags,
        machine: p.machine,
        statement: p.statementMd,
        starter: p.starter,
      };
    },
  },

  get_workspace: {
    description:
      "Read the student's current files for a problem, plus their recent test runs (status + summary).",
    schema: z.object({ key: z.string() }),
    inputSchema: {
      type: "object",
      properties: { key: str("Problem key") },
      required: ["key"],
    },
    handler: async (args, ctx) => {
      const { key } = args as { key: string };
      const user = await mcpUser(ctx);
      const problem = await getProblemByKey(key);
      if (!problem) throw new McpToolError(`problem not found: ${key}`);
      const [ws, runs] = await Promise.all([
        db.workspace.findUnique({ where: { userId_problemKey: { userId: user.id, problemKey: key } } }),
        db.run.findMany({
          where: { userId: user.id, problemKey: key },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, status: true, backend: true, results: true, createdAt: true },
        }),
      ]);
      return {
        key,
        files: (ws?.files as FileMap | undefined) ?? problem.starter,
        usingStarter: !ws,
        recentRuns: runs,
      };
    },
  },

  get_run: {
    description: "Fetch a test run's full logs and structured results by run id.",
    schema: z.object({ run_id: z.string() }),
    inputSchema: {
      type: "object",
      properties: { run_id: str("Run id from get_workspace.recentRuns or run_tests") },
      required: ["run_id"],
    },
    handler: async (args, ctx) => {
      const { run_id } = args as { run_id: string };
      const user = await mcpUser(ctx);
      const run = await db.run.findUnique({ where: { id: run_id } });
      if (!run || run.userId !== user.id) throw new McpToolError(`run not found: ${run_id}`);
      return {
        id: run.id,
        problem: run.problemKey,
        status: run.status,
        backend: run.backend,
        logs: run.logs,
        results: run.results,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
      };
    },
  },

  run_tests: {
    description:
      "Kick off a test run for a problem using the student's current saved files. Returns the run id; poll get_run for results.",
    schema: z.object({ key: z.string() }),
    inputSchema: {
      type: "object",
      properties: { key: str("Problem key") },
      required: ["key"],
    },
    handler: async (args, ctx) => {
      const { key } = args as { key: string };
      const user = await mcpUser(ctx);
      const problem = await getProblemByKey(key);
      if (!problem) throw new McpToolError(`problem not found: ${key}`);
      const ws = await db.workspace.findUnique({
        where: { userId_problemKey: { userId: user.id, problemKey: key } },
      });
      const files = (ws?.files as FileMap | undefined) ?? problem.starter;
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
      // Fire and forget; MCP client polls get_run.
      void executeRun(run.id);
      return { run_id: run.id, status: "queued" };
    },
  },

  post_hint: {
    description:
      "Post a hint or feedback message into the student's chat sidebar for a problem. Use for help the student asked Claude Code for.",
    schema: z.object({ key: z.string(), hint: z.string().min(1) }),
    inputSchema: {
      type: "object",
      properties: { key: str("Problem key"), hint: str("Markdown hint text shown in the problem's chat sidebar") },
      required: ["key", "hint"],
    },
    handler: async (args, ctx) => {
      const { key, hint } = args as { key: string; hint: string };
      const user = await mcpUser(ctx);
      if (!(await getProblemByKey(key))) throw new McpToolError(`problem not found: ${key}`);
      const msg = await db.chatMessage.create({
        data: { userId: user.id, problemKey: key, role: "mcp", content: hint },
      });
      return { ok: true, message_id: msg.id };
    },
  },

  assign_task: {
    description:
      "Assign a new task/project to the student. It appears under the 'Assigned by Claude' course on their dashboard. " +
      "Provide a multi-part markdown statement, starter files, and tests. Tests must include run_tests.py which uses " +
      "`from labbench import case, run` — decorate test functions with @case('name') and call run() at the end. " +
      "machine controls the sandbox: pip packages, image, cpu/memoryMb/gpu (gpu/pip need Modal configured).",
    schema: z.object({
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      title: z.string().min(1),
      statement_md: z.string().min(1),
      starter: FileMapSchema,
      tests: FileMapSchema.refine((t) => "run_tests.py" in t, { message: "tests must include run_tests.py" }),
      machine: MachineSchema,
      difficulty: z.enum(["easy", "medium", "hard"]).optional(),
      tags: z.array(z.string()).optional(),
    }),
    inputSchema: {
      type: "object",
      properties: {
        slug: str("URL slug for the task, e.g. 'build-a-webhook'"),
        title: str("Task title"),
        statement_md: str("Multi-part problem statement in markdown (KaTeX supported via $...$)"),
        starter: filesJson("Starter files: map of relative path -> contents"),
        tests: filesJson("Test files: map of relative path -> contents. Must include run_tests.py using the labbench harness."),
        machine: {
          type: "object",
          description: "Sandbox machine spec (all optional): backend auto|local|modal, image, gpu (none|T4|L4|A10G|A100|H100), cpu, memoryMb, pip (string[]), timeoutSec",
        },
        difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["slug", "title", "statement_md", "starter", "tests"],
    },
    handler: async (args, ctx) => {
      const a = args as {
        slug: string; title: string; statement_md: string;
        starter: FileMap; tests: FileMap; machine?: Partial<MachineSpec>;
        difficulty?: string; tags?: string[];
      };
      const user = await mcpUser(ctx);
      const machine = normalizeMachine({ ...DEFAULT_MACHINE, ...(a.machine ?? {}) });
      const problem = await db.problem.upsert({
        where: { courseSlug_slug: { courseSlug: "assigned", slug: a.slug } },
        create: {
          courseSlug: "assigned",
          slug: a.slug,
          title: a.title,
          statementMd: a.statement_md,
          starter: a.starter,
          tests: a.tests,
          machine: machine as unknown as object,
          difficulty: a.difficulty ?? "medium",
          tags: a.tags ?? [],
          assignedTo: user.id,
        },
        update: {
          title: a.title,
          statementMd: a.statement_md,
          starter: a.starter,
          tests: a.tests,
          machine: machine as unknown as object,
          difficulty: a.difficulty ?? "medium",
          tags: a.tags ?? [],
        },
      });
      return { ok: true, key: `assigned/${problem.slug}`, url: `/p/assigned/${problem.slug}` };
    },
  },
  update_task: {
    description:
      "Update a task previously created with assign_task (only DB-backed tasks under the 'assigned' course; " +
      "file-based course problems are read-only). Every field is optional — only what you pass changes. " +
      "starter/tests are merged by path into the existing files (pass null as a file's value to delete it, " +
      "or set replace_files=true to replace the whole map). machine is merged into the existing spec. " +
      "The student's saved workspace is never modified — starter changes only affect a fresh workspace.",
    schema: z.object({
      slug: z.string().regex(/^(assigned\/)?[a-z0-9][a-z0-9-]*$/),
      title: z.string().min(1).optional(),
      statement_md: z.string().min(1).optional(),
      starter: z.record(z.string(), z.string().nullable()).optional(),
      tests: z.record(z.string(), z.string().nullable()).optional(),
      replace_files: z.boolean().optional(),
      machine: MachineSchema,
      difficulty: z.enum(["easy", "medium", "hard"]).optional(),
      tags: z.array(z.string()).optional(),
    }),
    inputSchema: {
      type: "object",
      properties: {
        slug: str("Slug of the assigned task (as given to assign_task), or its key 'assigned/<slug>'"),
        title: str("New title"),
        statement_md: str("New multi-part markdown statement (replaces the whole statement)"),
        starter: {
          type: "object",
          description: "Starter files to add/replace, map of path -> contents. A null value deletes that file.",
          additionalProperties: { type: ["string", "null"] },
        },
        tests: {
          type: "object",
          description: "Test files to add/replace, map of path -> contents. A null value deletes that file. run_tests.py must remain.",
          additionalProperties: { type: ["string", "null"] },
        },
        replace_files: {
          type: "boolean",
          description: "If true, starter/tests given here replace the existing maps entirely instead of merging (default false).",
        },
        machine: {
          type: "object",
          description: "Partial sandbox machine spec to merge: backend auto|local|modal, image, gpu, cpu, memoryMb, pip (string[]), timeoutSec",
        },
        difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        tags: { type: "array", items: { type: "string" }, description: "Replaces the tag list" },
      },
      required: ["slug"],
    },
    handler: async (args, ctx) => {
      const a = args as {
        slug: string; title?: string; statement_md?: string;
        starter?: Record<string, string | null>; tests?: Record<string, string | null>;
        replace_files?: boolean; machine?: Partial<MachineSpec>;
        difficulty?: string; tags?: string[];
      };
      const user = await mcpUser(ctx);
      const slug = a.slug.replace(/^assigned\//, "");
      const existing = await db.problem.findUnique({ where: { courseSlug_slug: { courseSlug: "assigned", slug } } });
      if (!existing) {
        throw new McpToolError(
          `No assigned task with slug '${slug}'. Only tasks created via assign_task can be updated; use list_problems to see them.`
        );
      }
      if (existing.assignedTo && existing.assignedTo !== user.id) {
        throw new McpToolError(`Task '${slug}' is assigned to a different user.`);
      }

      const mergeFiles = (current: FileMap, patch?: Record<string, string | null>): FileMap => {
        if (!patch) return current;
        const out: FileMap = a.replace_files ? {} : { ...current };
        for (const [path, contents] of Object.entries(patch)) {
          if (contents === null) delete out[path];
          else out[path] = contents;
        }
        return out;
      };
      const starter = mergeFiles(existing.starter as FileMap, a.starter);
      const tests = mergeFiles(existing.tests as FileMap, a.tests);
      if (!("run_tests.py" in tests)) throw new McpToolError("tests must still include run_tests.py after the update.");
      if (Object.keys(starter).length === 0) throw new McpToolError("starter cannot end up empty.");

      const machine = a.machine
        ? normalizeMachine({ ...DEFAULT_MACHINE, ...(existing.machine as Partial<MachineSpec>), ...a.machine })
        : undefined;

      const changed: string[] = [];
      const data: Record<string, unknown> = {};
      if (a.title !== undefined) { data.title = a.title; changed.push("title"); }
      if (a.statement_md !== undefined) { data.statementMd = a.statement_md; changed.push("statement"); }
      if (a.starter) { data.starter = starter; changed.push("starter"); }
      if (a.tests) { data.tests = tests; changed.push("tests"); }
      if (machine) { data.machine = machine as unknown as object; changed.push("machine"); }
      if (a.difficulty !== undefined) { data.difficulty = a.difficulty; changed.push("difficulty"); }
      if (a.tags !== undefined) { data.tags = a.tags; changed.push("tags"); }
      if (changed.length === 0) throw new McpToolError("Nothing to update — pass at least one field besides slug.");

      const problem = await db.problem.update({ where: { id: existing.id }, data });
      return {
        ok: true,
        key: `assigned/${problem.slug}`,
        url: `/p/assigned/${problem.slug}`,
        updated: changed,
        starter_files: Object.keys(starter),
        test_files: Object.keys(tests),
      };
    },
  },
};

export async function callTool(name: string, args: unknown, ctx: McpContext = {}): Promise<unknown> {
  const tool = tools[name];
  if (!tool) throw new McpToolError(`unknown tool: ${name}`);
  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) {
    throw new McpToolError(`invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return tool.handler(parsed.data, ctx);
}
