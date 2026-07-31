// Local subprocess runner — dev/self-hosted backend.
//
// Runs the submission as a python subprocess in a scratch directory with a
// wall-clock timeout. No pip installs and no isolation beyond a fresh cwd, so
// use it for stdlib-only problems in dev; production should use Modal.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HARNESS_FILENAME, HARNESS_SOURCE } from "@/lib/runner/harness";
import { cleanLogs, parseResults } from "@/lib/runner/results";
import { RunJob, RunOutcome, RunnerBackend } from "@/lib/runner/types";
import { FileMap } from "@/lib/types";

function writeFiles(root: string, files: FileMap) {
  for (const [rel, contents] of Object.entries(files)) {
    // Refuse path escapes ("../..", absolute paths).
    const dest = path.resolve(root, rel);
    if (!dest.startsWith(root + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, contents);
  }
}

export const localRunner: RunnerBackend = {
  name: "local",

  async run(job: RunJob): Promise<RunOutcome> {
    const baseDir = path.resolve(process.cwd(), process.env.LOCAL_RUNNER_DIR || ".runs");
    fs.mkdirSync(baseDir, { recursive: true });
    const workDir = fs.mkdtempSync(path.join(baseDir, `run-${job.runId.slice(-8)}-`));

    try {
      writeFiles(workDir, job.files);
      writeFiles(workDir, job.tests); // tests overwrite user files, never vice versa
      fs.writeFileSync(path.join(workDir, HARNESS_FILENAME), HARNESS_SOURCE);

      if (!job.tests["run_tests.py"]) {
        return { status: "error", logs: "Problem has no run_tests.py — nothing to run.", results: null };
      }

      const timeoutMs = Math.max(1, job.machine.timeoutSec) * 1000;
      let logs = "";
      if (job.machine.pip.length > 0) {
        logs += `note: local runner does not pip install (${job.machine.pip.join(", ")}); ` +
          `packages must already be importable, or configure Modal for this problem.\n`;
      }

      const outcome = await new Promise<RunOutcome>((resolve) => {
        const child = spawn("python3", ["run_tests.py"], {
          cwd: workDir,
          env: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            HOME: os.tmpdir(),
            PYTHONUNBUFFERED: "1",
            PYTHONDONTWRITEBYTECODE: "1",
          },
          stdio: ["ignore", "pipe", "pipe"] as const,
        });

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeoutMs);

        const cap = 200_000; // cap captured logs at ~200KB
        const append = (chunk: Buffer) => {
          if (logs.length < cap) logs += chunk.toString("utf8").slice(0, cap - logs.length);
        };
        child.stdout.on("data", append);
        child.stderr.on("data", append);

        child.on("error", (err) => {
          clearTimeout(timer);
          resolve({ status: "error", logs: logs + `\nrunner error: ${err.message}`, results: null });
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          const results = parseResults(logs);
          const shown = cleanLogs(logs);
          if (timedOut) {
            resolve({ status: "timeout", logs: shown + `\n\n⏱ killed after ${job.machine.timeoutSec}s`, results });
          } else if (results) {
            resolve({ status: results.passed === results.total && results.total > 0 ? "passed" : "failed", logs: shown, results });
          } else {
            resolve({ status: code === 0 ? "failed" : "error", logs: shown, results: null });
          }
        });
      });

      return outcome;
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  },
};
