// Unified problem catalog: file-based content + DB-stored problems
// (e.g. tasks assigned by Claude over MCP).

import { db } from "@/lib/db";
import {
  listContentCourses,
  loadContentCourse,
  loadContentProblem,
  normalizeMachine,
} from "@/lib/content";
import { CourseSummary, FileMap, ProblemDetail, ProblemSummary } from "@/lib/types";
import type { Problem as DbProblem } from "@prisma/client";

export const ASSIGNED_COURSE: Omit<CourseSummary, "problems"> = {
  slug: "assigned",
  title: "Assigned by Claude",
  description: "Projects and exercises Claude assigned to you over MCP.",
  source: "assigned",
};

function dbProblemToSummary(p: DbProblem): ProblemSummary {
  return {
    courseSlug: p.courseSlug,
    slug: p.slug,
    key: `${p.courseSlug}/${p.slug}`,
    title: p.title,
    difficulty: p.difficulty,
    tags: p.tags,
    source: "assigned",
  };
}

function dbProblemToDetail(p: DbProblem): ProblemDetail {
  return {
    ...dbProblemToSummary(p),
    statementMd: p.statementMd,
    starter: (p.starter ?? {}) as FileMap,
    tests: (p.tests ?? {}) as FileMap,
    machine: normalizeMachine(p.machine),
  };
}

/** All courses: file-based content plus the virtual "assigned" course for this user. */
export async function listCourses(userId?: string): Promise<CourseSummary[]> {
  const courses = listContentCourses();
  const where = userId
    ? { OR: [{ assignedTo: userId }, { assignedTo: null }] }
    : {};
  const dbProblems = await db.problem.findMany({ where, orderBy: { createdAt: "desc" } });
  if (dbProblems.length > 0) {
    courses.push({ ...ASSIGNED_COURSE, problems: dbProblems.map(dbProblemToSummary) });
  }
  return courses;
}

export async function getCourse(slug: string, userId?: string): Promise<CourseSummary | null> {
  const content = loadContentCourse(slug);
  if (content) return content;
  const where = userId
    ? { courseSlug: slug, OR: [{ assignedTo: userId }, { assignedTo: null }] }
    : { courseSlug: slug };
  const dbProblems = await db.problem.findMany({ where, orderBy: { createdAt: "desc" } });
  if (dbProblems.length === 0) return null;
  return { ...ASSIGNED_COURSE, slug, problems: dbProblems.map(dbProblemToSummary) };
}

export async function getProblem(courseSlug: string, slug: string): Promise<ProblemDetail | null> {
  const content = loadContentProblem(courseSlug, slug);
  if (content) return content;
  const p = await db.problem.findUnique({
    where: { courseSlug_slug: { courseSlug, slug } },
  });
  return p ? dbProblemToDetail(p) : null;
}

export async function getProblemByKey(key: string): Promise<ProblemDetail | null> {
  const idx = key.indexOf("/");
  if (idx <= 0) return null;
  return getProblem(key.slice(0, idx), key.slice(idx + 1));
}
