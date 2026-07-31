import { TestResults } from "@/lib/types";
import { RESULTS_MARKER } from "@/lib/runner/harness";

/** Extract the machine-readable results line from sandbox output. */
export function parseResults(logs: string): TestResults | null {
  // Take the last marker line in case tests print the marker themselves.
  const lines = logs.split("\n").filter((l) => l.includes(RESULTS_MARKER));
  const line = lines[lines.length - 1];
  if (!line) return null;
  try {
    const json = line.slice(line.indexOf(RESULTS_MARKER) + RESULTS_MARKER.length);
    const parsed = JSON.parse(json) as TestResults;
    if (typeof parsed.total !== "number" || !Array.isArray(parsed.cases)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Strip the marker line from logs shown to users. */
export function cleanLogs(logs: string): string {
  return logs
    .split("\n")
    .filter((l) => !l.includes(RESULTS_MARKER))
    .join("\n");
}
