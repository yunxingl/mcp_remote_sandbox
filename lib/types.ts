// Shared platform types.

/** Flat map of relative file path -> file contents. */
export type FileMap = Record<string, string>;

export interface MachineSpec {
  /** Which runner executes this problem. "auto" picks modal when configured, else local. */
  backend: "auto" | "local" | "modal";
  /** Container image for modal runs, e.g. "python:3.11-slim". */
  image: string;
  /** GPU type for modal runs: "none" | "T4" | "L4" | "A10G" | "A100" | "H100". */
  gpu: string;
  cpu: number;
  memoryMb: number;
  /** pip packages installed into the sandbox before running, e.g. ["torch", "numpy"]. */
  pip: string[];
  timeoutSec: number;
}

export const DEFAULT_MACHINE: MachineSpec = {
  backend: "auto",
  image: "python:3.11-slim",
  gpu: "none",
  cpu: 1,
  memoryMb: 1024,
  pip: [],
  timeoutSec: 120,
};

export interface TestCaseResult {
  name: string;
  passed: boolean;
  message?: string;
}

export interface TestResults {
  total: number;
  passed: number;
  cases: TestCaseResult[];
}

export type RunStatus = "queued" | "running" | "passed" | "failed" | "error" | "timeout";

export interface ProblemSummary {
  courseSlug: string;
  slug: string;
  /** "<courseSlug>/<slug>" — the canonical key used everywhere. */
  key: string;
  title: string;
  difficulty: string;
  tags: string[];
  source: "content" | "assigned";
}

export interface ProblemDetail extends ProblemSummary {
  statementMd: string;
  starter: FileMap;
  tests: FileMap;
  machine: MachineSpec;
}

export interface CourseSummary {
  slug: string;
  title: string;
  description: string;
  source: "content" | "assigned";
  problems: ProblemSummary[];
}
