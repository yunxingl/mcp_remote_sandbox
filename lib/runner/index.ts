// Backend selection + run execution.
//
// Backend resolution order:
//   1. problem machine.backend if "local" or "modal"
//   2. env RUNNER_BACKEND if "local" or "modal"
//   3. "auto": modal when MODAL_TOKEN_ID is configured, else local

import { db } from "@/lib/db";
import { getProblemByKey } from "@/lib/problems";
import { localRunner } from "@/lib/runner/local";
import { modalConfigured, modalRunner } from "@/lib/runner/modal";
import { RunnerBackend } from "@/lib/runner/types";
import { FileMap, MachineSpec } from "@/lib/types";

export function resolveBackend(machine: MachineSpec): RunnerBackend {
  const pick = (v: string | undefined) => (v === "local" ? localRunner : v === "modal" ? modalRunner : null);
  return (
    pick(machine.backend) ??
    pick(process.env.RUNNER_BACKEND) ??
    (modalConfigured() ? modalRunner : localRunner)
  );
}

/**
 * Execute a queued Run row: mark running, invoke backend, persist outcome.
 * Called via next/server `after()` so it survives past the API response.
 */
export async function executeRun(runId: string): Promise<void> {
  const run = await db.run.findUnique({ where: { id: runId } });
  if (!run || run.status !== "queued") return;

  const machine = run.machine as unknown as MachineSpec;
  const backend = resolveBackend(machine);
  await db.run.update({ where: { id: runId }, data: { status: "running", backend: backend.name } });

  try {
    const problem = await getProblemByKey(run.problemKey);
    if (!problem) throw new Error(`problem not found: ${run.problemKey}`);
    const outcome = await backend.run({
      runId,
      files: (run.files ?? {}) as FileMap,
      tests: problem.tests,
      machine,
    });
    await db.run.update({
      where: { id: runId },
      data: {
        status: outcome.status,
        logs: outcome.logs,
        results: outcome.results === null ? undefined : (outcome.results as object),
        finishedAt: new Date(),
      },
    });
  } catch (e) {
    await db.run.update({
      where: { id: runId },
      data: {
        status: "error",
        logs: `runner crashed: ${e instanceof Error ? e.message : String(e)}`,
        finishedAt: new Date(),
      },
    });
  }
}
