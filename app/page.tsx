import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, signOut } from "@/lib/auth";
import { listCourses } from "@/lib/problems";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const statusColor: Record<string, string> = {
  passed: "text-[var(--green)]",
  failed: "text-[var(--red)]",
  error: "text-[var(--red)]",
  timeout: "text-[var(--yellow)]",
  running: "text-[var(--yellow)]",
  queued: "text-[var(--text-dim)]",
};

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const [courses, recentRuns] = await Promise.all([
    listCourses(user.id),
    db.run.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, problemKey: true, status: true, backend: true, createdAt: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🧪 LabBench</h1>
          <p className="mt-1 text-sm text-[var(--text-dim)]">{user.email}</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)]">
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)]">Courses</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {courses.map((course) => (
            <Link
              key={course.slug}
              href={`/course/${course.slug}`}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-5 transition hover:border-[var(--accent-dim)]"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{course.title}</h3>
                <span className="text-xs text-[var(--text-dim)]">
                  {course.problems.length} problem{course.problems.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-2 text-sm text-[var(--text-dim)]">{course.description}</p>
            </Link>
          ))}
          {courses.length === 0 && (
            <p className="text-sm text-[var(--text-dim)]">
              No courses yet. Add one under <code>content/courses/</code> or ask Claude to{" "}
              <code>assign_task</code> over MCP.
            </p>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)]">Recent runs</h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-panel)]">
          {recentRuns.length === 0 && (
            <p className="p-4 text-sm text-[var(--text-dim)]">No runs yet.</p>
          )}
          {recentRuns.map((run) => (
            <Link
              key={run.id}
              href={`/p/${run.problemKey}`}
              className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5 text-sm last:border-b-0 hover:bg-[var(--bg-raised)]"
            >
              <span className="font-mono text-xs">{run.problemKey}</span>
              <span className="flex items-center gap-3 text-xs">
                <span className="text-[var(--text-dim)]">{run.backend}</span>
                <span className={statusColor[run.status] ?? ""}>{run.status}</span>
                <span className="text-[var(--text-dim)]">
                  {new Date(run.createdAt).toLocaleString()}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
