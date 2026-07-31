import { FileMap, MachineSpec, TestResults } from "@/lib/types";

export interface RunJob {
  runId: string;
  /** User-submitted files. */
  files: FileMap;
  /** Problem test files (copied over user files — users can't overwrite tests). */
  tests: FileMap;
  machine: MachineSpec;
}

export interface RunOutcome {
  status: "passed" | "failed" | "error" | "timeout";
  logs: string;
  results: TestResults | null;
}

export interface RunnerBackend {
  name: "local" | "modal";
  run(job: RunJob): Promise<RunOutcome>;
}
