"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import Markdown from "@/components/Markdown";
import ChatPanel from "@/components/ChatPanel";
import RunsPanel, { RunDetail } from "@/components/RunsPanel";
import { FileMap, MachineSpec } from "@/lib/types";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-[var(--text-dim)]">Loading editor…</div>,
});

export interface WorkspaceProblem {
  key: string;
  courseSlug: string;
  title: string;
  difficulty: string;
  tags: string[];
  statementMd: string;
  starter: FileMap;
  machine: MachineSpec;
}

type SidebarTab = "problem" | "runs" | "chat";

function languageFor(path: string): string {
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "yaml";
  if (path.endsWith(".sh")) return "shell";
  if (path.endsWith(".c") || path.endsWith(".h")) return "c";
  if (path.endsWith(".cpp") || path.endsWith(".cc")) return "cpp";
  if (path.endsWith(".rs")) return "rust";
  if (path.endsWith(".go")) return "go";
  return "plaintext";
}

export default function Workspace({
  problem,
  initialFiles,
}: {
  problem: WorkspaceProblem;
  initialFiles: FileMap;
}) {
  const [files, setFiles] = useState<FileMap>(initialFiles);
  const paths = useMemo(() => Object.keys(files).sort(), [files]);
  const [active, setActive] = useState<string>(paths[0] ?? "");
  const [tab, setTab] = useState<SidebarTab>("problem");
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">("saved");
  const [running, setRunning] = useState(false);
  const [currentRun, setCurrentRun] = useState<RunDetail | null>(null);
  const filesRef = useRef(files);
  filesRef.current = files;

  // ---- persistence -----------------------------------------------------

  const save = useCallback(async () => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: problem.key, files: filesRef.current }),
      });
      setSaveState(res.ok ? "saved" : "dirty");
    } catch {
      setSaveState("dirty");
    }
  }, [problem.key]);

  // Debounced autosave.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markDirty = useCallback(() => {
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 1200);
  }, [save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // ---- file ops --------------------------------------------------------

  const setFileContents = (path: string, contents: string) => {
    setFiles((f) => ({ ...f, [path]: contents }));
    markDirty();
  };

  const addFile = () => {
    const name = prompt("New file path (e.g. utils.py):")?.trim();
    if (!name || files[name] !== undefined) return;
    setFiles((f) => ({ ...f, [name]: "" }));
    setActive(name);
    markDirty();
  };

  const deleteFile = (path: string) => {
    if (!confirm(`Delete ${path}?`)) return;
    setFiles((f) => {
      const next = { ...f };
      delete next[path];
      return next;
    });
    if (active === path) setActive(paths.find((p) => p !== path) ?? "");
    markDirty();
  };

  const resetToStarter = () => {
    if (!confirm("Reset all files to the starter code? Your edits will be lost.")) return;
    setFiles({ ...problem.starter });
    setActive(Object.keys(problem.starter).sort()[0] ?? "");
    markDirty();
  };

  // ---- runs ------------------------------------------------------------

  const runTests = async () => {
    if (running) return;
    setRunning(true);
    setTab("runs");
    setCurrentRun(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: problem.key, files: filesRef.current }),
      });
      if (!res.ok) throw new Error(`run failed: ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      setSaveState("saved"); // POST /api/runs also saves the workspace

      // Poll until terminal.
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const poll = await fetch(`/api/runs/${id}`);
        if (!poll.ok) throw new Error(`poll failed: ${poll.status}`);
        const run = (await poll.json()) as RunDetail;
        setCurrentRun(run);
        if (["passed", "failed", "error", "timeout"].includes(run.status)) break;
      }
    } catch (e) {
      setCurrentRun({
        id: "",
        status: "error",
        backend: "",
        logs: e instanceof Error ? e.message : String(e),
        results: null,
        createdAt: "",
        finishedAt: null,
      });
    } finally {
      setRunning(false);
    }
  };

  // ---- layout ----------------------------------------------------------

  const m = problem.machine;
  const machineLabel =
    (m.gpu && m.gpu !== "none" ? `${m.gpu} · ` : "") + `${m.cpu} cpu · ${Math.round(m.memoryMb / 1024)}G` +
    (m.pip.length ? ` · pip: ${m.pip.join(", ")}` : "");

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-panel)] px-4 py-2">
        <div className="flex items-center gap-3 overflow-hidden">
          <Link href={`/course/${problem.courseSlug}`} className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">
            ← {problem.courseSlug}
          </Link>
          <h1 className="truncate text-sm font-semibold">{problem.title}</h1>
          <span className="hidden rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-dim)] md:inline">
            {machineLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-dim)]">
            {saveState === "saved" ? "saved" : saveState === "saving" ? "saving…" : "unsaved"}
          </span>
          <button
            onClick={resetToStarter}
            className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
          >
            Reset
          </button>
          <button
            onClick={runTests}
            disabled={running}
            className="rounded-md bg-[var(--accent)] px-3.5 py-1 text-xs font-semibold text-[#0b0e14] disabled:opacity-50"
          >
            {running ? "Running…" : "▶ Run tests"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---- sidebar ---- */}
        <aside className="flex w-[44%] min-w-[320px] max-w-[640px] flex-col border-r border-[var(--border)] bg-[var(--bg-panel)]">
          <nav className="flex border-b border-[var(--border)]">
            {(
              [
                ["problem", "Problem"],
                ["runs", "Tests"],
                ["chat", "Claude"],
              ] as [SidebarTab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={
                  "px-4 py-2 text-xs font-medium " +
                  (tab === id
                    ? "border-b-2 border-[var(--accent)] text-[var(--text)]"
                    : "text-[var(--text-dim)] hover:text-[var(--text)]")
                }
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "problem" && (
              <div className="p-5">
                <Markdown>{problem.statementMd}</Markdown>
              </div>
            )}
            {tab === "runs" && (
              <RunsPanel problemKey={problem.key} currentRun={currentRun} running={running} />
            )}
            {tab === "chat" && <ChatPanel problemKey={problem.key} />}
          </div>
        </aside>

        {/* ---- editor ---- */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center border-b border-[var(--border)] bg-[var(--bg-panel)]">
            <div className="flex flex-1 overflow-x-auto">
              {paths.map((p) => (
                <div
                  key={p}
                  className={
                    "group flex items-center gap-1.5 border-r border-[var(--border)] px-3 py-1.5 text-xs " +
                    (active === p
                      ? "bg-[var(--bg)] text-[var(--text)]"
                      : "cursor-pointer text-[var(--text-dim)] hover:text-[var(--text)]")
                  }
                  onClick={() => setActive(p)}
                >
                  <span className="font-mono">{p}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFile(p);
                    }}
                    className="invisible text-[var(--text-dim)] hover:text-[var(--red)] group-hover:visible"
                    title={`Delete ${p}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addFile}
              className="px-3 py-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
              title="New file"
            >
              ＋
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {active && files[active] !== undefined ? (
              <MonacoEditor
                path={active}
                language={languageFor(active)}
                value={files[active]}
                onChange={(v) => setFileContents(active, v ?? "")}
                theme="vs-dark"
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  tabSize: 4,
                  automaticLayout: true,
                  padding: { top: 10 },
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-dim)]">
                No file selected — create one with ＋
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
