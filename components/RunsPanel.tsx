"use client";

import { useEffect, useState } from "react";
import { TestResults } from "@/lib/types";

export interface RunDetail {
  id: string;
  status: string;
  backend: string;
  logs: string;
  results: TestResults | null;
  createdAt: string;
  finishedAt: string | null;
}

interface RunSummary {
  id: string;
  status: string;
  backend: string;
  results: TestResults | null;
  createdAt: string;
}

const statusStyle: Record<string, string> = {
  passed: "text-[var(--green)]",
  failed: "text-[var(--red)]",
  error: "text-[var(--red)]",
  timeout: "text-[var(--yellow)]",
  running: "text-[var(--yellow)]",
  queued: "text-[var(--text-dim)]",
};

export default function RunsPanel({
  problemKey,
  currentRun,
  running,
}: {
  problemKey: string;
  currentRun: RunDetail | null;
  running: boolean;
}) {
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);

  useEffect(() => {
    fetch(`/api/runs?key=${encodeURIComponent(problemKey)}`)
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((d) => setHistory(d.runs ?? []))
      .catch(() => {});
  }, [problemKey, currentRun?.status]);

  const shown = selected ?? currentRun;

  return (
    <div className="flex h-full flex-col">
      {running && !shown && (
        <div className="p-5 text-sm text-[var(--yellow)]">⏳ Spinning up sandbox…</div>
      )}

      {shown && (
        <div className="border-b border-[var(--border)] p-5">
          <div className="flex items-center justify-between">
            <span className={"text-sm font-semibold " + (statusStyle[shown.status] ?? "")}>
              {shown.status === "running" || shown.status === "queued" ? "⏳ " : ""}
              {shown.status.toUpperCase()}
            </span>
            {shown.backend && (
              <span className="text-[10px] text-[var(--text-dim)]">sandbox: {shown.backend}</span>
            )}
          </div>

          {shown.results && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs text-[var(--text-dim)]">
                {shown.results.passed}/{shown.results.total} tests passed
              </p>
              {shown.results.cases.map((c) => (
                <div key={c.name} className="rounded-md border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-1.5 text-xs">
                  <span className={c.passed ? "text-[var(--green)]" : "text-[var(--red)]"}>
                    {c.passed ? "✓" : "✗"}
                  </span>{" "}
                  {c.name}
                  {!c.passed && c.message && (
                    <div className="mt-1 font-mono text-[11px] text-[var(--text-dim)]">{c.message}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {shown.logs && (
            <details className="mt-3" open={!shown.results}>
              <summary className="cursor-pointer text-xs text-[var(--text-dim)]">Logs</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg-raised)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {shown.logs}
              </pre>
            </details>
          )}
        </div>
      )}

      <div className="p-5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">History</h3>
        <div className="mt-2 space-y-1">
          {history.length === 0 && <p className="text-xs text-[var(--text-dim)]">No runs yet.</p>}
          {history.map((run) => (
            <button
              key={run.id}
              onClick={() =>
                fetch(`/api/runs/${run.id}`)
                  .then((r) => (r.ok ? r.json() : null))
                  .then((d) => d && setSelected(d))
              }
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-raised)]"
            >
              <span className={statusStyle[run.status] ?? ""}>
                {run.status}
                {run.results ? ` (${run.results.passed}/${run.results.total})` : ""}
              </span>
              <span className="text-[10px] text-[var(--text-dim)]">
                {new Date(run.createdAt).toLocaleTimeString()} · {run.backend}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
