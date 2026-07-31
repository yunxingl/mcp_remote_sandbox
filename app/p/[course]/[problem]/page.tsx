import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getProblem } from "@/lib/problems";
import { db } from "@/lib/db";
import Workspace from "@/components/Workspace";
import { FileMap } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProblemPage(props: {
  params: Promise<{ course: string; problem: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { course, problem: problemSlug } = await props.params;
  const problem = await getProblem(course, problemSlug);
  if (!problem) notFound();

  const ws = await db.workspace.findUnique({
    where: { userId_problemKey: { userId: user.id, problemKey: problem.key } },
  });
  const initialFiles = (ws?.files as FileMap | undefined) ?? problem.starter;

  return (
    <Workspace
      problem={{
        key: problem.key,
        courseSlug: problem.courseSlug,
        title: problem.title,
        difficulty: problem.difficulty,
        tags: problem.tags,
        statementMd: problem.statementMd,
        starter: problem.starter,
        machine: problem.machine,
      }}
      initialFiles={initialFiles}
    />
  );
}
