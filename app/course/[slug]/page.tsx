import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getCourse } from "@/lib/problems";

export const dynamic = "force-dynamic";

export default async function CoursePage(props: { params: Promise<{ slug: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { slug } = await props.params;
  const course = await getCourse(slug, user.id);
  if (!course) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/" className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">
        ← Dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{course.title}</h1>
      <p className="mt-2 text-sm text-[var(--text-dim)]">{course.description}</p>

      <div className="mt-8 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-panel)]">
        {course.problems.map((p, i) => (
          <Link
            key={p.key}
            href={`/p/${p.key}`}
            className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5 last:border-b-0 hover:bg-[var(--bg-raised)]"
          >
            <span className="flex items-center gap-3">
              <span className="w-6 text-right font-mono text-xs text-[var(--text-dim)]">{i + 1}</span>
              <span className="text-sm font-medium">{p.title}</span>
            </span>
            <span className="flex items-center gap-2">
              {p.tags.map((t) => (
                <span key={t} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-dim)]">
                  {t}
                </span>
              ))}
              <span
                className={
                  "text-xs " +
                  (p.difficulty === "easy"
                    ? "text-[var(--green)]"
                    : p.difficulty === "hard"
                      ? "text-[var(--red)]"
                      : "text-[var(--yellow)]")
                }
              >
                {p.difficulty}
              </span>
            </span>
          </Link>
        ))}
        {course.problems.length === 0 && (
          <p className="p-5 text-sm text-[var(--text-dim)]">No problems in this course yet.</p>
        )}
      </div>
    </main>
  );
}
