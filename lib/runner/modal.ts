// Modal Sandbox runner — production backend with arbitrary machine types.
//
// Each run gets a fresh Modal Sandbox built from the problem's machine spec
// (image, cpu, memory, gpu, pip packages). Files are shipped in as a base64
// JSON payload, then `python3 run_tests.py` executes and its output is parsed
// with the same protocol as the local runner.
//
// Requires MODAL_TOKEN_ID / MODAL_TOKEN_SECRET (https://modal.com/settings/tokens).

import { ModalClient, type Sandbox } from "modal";
import { HARNESS_FILENAME, HARNESS_SOURCE } from "@/lib/runner/harness";
import { cleanLogs, parseResults } from "@/lib/runner/results";
import { RunJob, RunOutcome, RunnerBackend } from "@/lib/runner/types";
import { FileMap } from "@/lib/types";

const APP_NAME = process.env.MODAL_APP_NAME || "labbench";
const WORKDIR = "/work";

let clientSingleton: ModalClient | null = null;

export function modalConfigured(): boolean {
  return !!process.env.MODAL_TOKEN_ID && !!process.env.MODAL_TOKEN_SECRET;
}

function getClient(): ModalClient {
  if (!clientSingleton) {
    clientSingleton = new ModalClient({
      tokenId: process.env.MODAL_TOKEN_ID,
      tokenSecret: process.env.MODAL_TOKEN_SECRET,
    });
  }
  return clientSingleton;
}

// Python one-liner target: reads a base64(JSON FileMap) argv payload and
// writes each file under the workdir, refusing path escapes.
const FILE_LOADER = `
import base64, json, os, sys
root = os.path.realpath("${WORKDIR}")
files = json.loads(base64.b64decode(sys.argv[1]).decode())
for rel, contents in files.items():
    dest = os.path.realpath(os.path.join(root, rel))
    if not dest.startswith(root + os.sep):
        continue
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        f.write(contents)
print(f"wrote {len(files)} files")
`;

async function drain(proc: {
  stdout: { readText(): Promise<string> };
  stderr: { readText(): Promise<string> };
  wait(): Promise<number>;
}) {
  const [out, err, code] = await Promise.all([
    proc.stdout.readText(),
    proc.stderr.readText(),
    proc.wait(),
  ]);
  return { output: out + (err ? `\n${err}` : ""), code };
}

export const modalRunner: RunnerBackend = {
  name: "modal",

  async run(job: RunJob): Promise<RunOutcome> {
    if (!modalConfigured()) {
      return {
        status: "error",
        logs: "Modal is not configured. Set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET (see .env.example).",
        results: null,
      };
    }
    if (!job.tests["run_tests.py"]) {
      return { status: "error", logs: "Problem has no run_tests.py — nothing to run.", results: null };
    }

    const spec = job.machine;
    let sb: Sandbox | null = null;
    let logs = "";
    try {
      const client = getClient();
      const app = await client.apps.fromName(APP_NAME, { createIfMissing: true });
      const image = client.images.fromRegistry(spec.image);
      sb = await client.sandboxes.create(app, image, {
        cpu: spec.cpu,
        memoryMiB: spec.memoryMb,
        gpu: spec.gpu && spec.gpu !== "none" ? spec.gpu : undefined,
        workdir: WORKDIR,
        // Sandbox lifetime: test timeout plus headroom for pip installs.
        timeoutMs: (spec.timeoutSec + 600) * 1000,
      });
      logs += `modal: sandbox ${sb.sandboxId} (${spec.image}, cpu=${spec.cpu}, mem=${spec.memoryMb}MiB, gpu=${spec.gpu})\n`;

      // 1. Ship files: user files first, then tests (tests win), then harness.
      const files: FileMap = { ...job.files, ...job.tests, [HARNESS_FILENAME]: HARNESS_SOURCE };
      const payload = Buffer.from(JSON.stringify(files)).toString("base64");
      const load = await sb.exec(["python3", "-c", FILE_LOADER, payload]);
      const loadRes = await drain(load);
      if (loadRes.code !== 0) {
        return { status: "error", logs: logs + `failed to write files:\n${loadRes.output}`, results: null };
      }

      // 2. pip install requested packages.
      if (spec.pip.length > 0) {
        logs += `modal: pip install ${spec.pip.join(" ")}\n`;
        const pip = await sb.exec(["python3", "-m", "pip", "install", "--quiet", ...spec.pip]);
        const pipRes = await drain(pip);
        if (pipRes.code !== 0) {
          return { status: "error", logs: logs + `pip install failed:\n${pipRes.output}`, results: null };
        }
      }

      // 3. Run tests with the problem's wall-clock timeout.
      const proc = await sb.exec(["python3", "run_tests.py"], {
        workdir: WORKDIR,
        timeoutMs: spec.timeoutSec * 1000,
      });
      let testRes: { output: string; code: number };
      try {
        testRes = await drain(proc);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/timeout/i.test(msg)) {
          return { status: "timeout", logs: logs + `\n⏱ killed after ${spec.timeoutSec}s`, results: null };
        }
        throw e;
      }

      const results = parseResults(testRes.output);
      logs += cleanLogs(testRes.output);
      if (results) {
        const passed = results.total > 0 && results.passed === results.total;
        return { status: passed ? "passed" : "failed", logs, results };
      }
      return { status: testRes.code === 0 ? "failed" : "error", logs, results: null };
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return { status: "error", logs: logs + `\nmodal runner error: ${msg}`, results: null };
    } finally {
      if (sb) {
        try {
          await sb.terminate();
        } catch {
          // best-effort cleanup; sandbox timeoutMs is the backstop
        }
      }
    }
  },
};
