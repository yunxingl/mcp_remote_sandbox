// File-based course content loader.
//
// Layout:
//   content/courses/<course>/course.yaml            { title, description, problems: [slug, ...] }
//   content/courses/<course>/problems/<slug>/
//     problem.yaml    { title, difficulty, tags, machine: {...} }
//     statement.md    multi-part problem statement (markdown + KaTeX)
//     starter/**      starter files shown in the editor
//     tests/**        test files copied into the sandbox; must include run_tests.py
//
// Everything is read fresh from disk on each request (content is small and this
// keeps authoring friction at zero: edit markdown, refresh the page).

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  CourseSummary,
  DEFAULT_MACHINE,
  FileMap,
  MachineSpec,
  ProblemDetail,
  ProblemSummary,
} from "@/lib/types";

const CONTENT_ROOT = path.join(process.cwd(), "content", "courses");

function readDirAsFileMap(dir: string): FileMap {
  const files: FileMap = {};
  if (!fs.existsSync(dir)) return files;
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const relPath = rel ? path.posix.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) walk(relPath);
      else files[relPath] = fs.readFileSync(path.join(dir, relPath), "utf8");
    }
  };
  walk("");
  return files;
}

export function normalizeMachine(raw: unknown): MachineSpec {
  const m = (raw ?? {}) as Partial<MachineSpec>;
  return {
    backend: m.backend ?? DEFAULT_MACHINE.backend,
    image: m.image ?? DEFAULT_MACHINE.image,
    gpu: m.gpu ?? DEFAULT_MACHINE.gpu,
    cpu: m.cpu ?? DEFAULT_MACHINE.cpu,
    memoryMb: m.memoryMb ?? DEFAULT_MACHINE.memoryMb,
    pip: Array.isArray(m.pip) ? m.pip : DEFAULT_MACHINE.pip,
    timeoutSec: m.timeoutSec ?? DEFAULT_MACHINE.timeoutSec,
  };
}

interface CourseYaml {
  title: string;
  description?: string;
  problems?: string[];
}

interface ProblemYaml {
  title: string;
  difficulty?: string;
  tags?: string[];
  machine?: Partial<MachineSpec>;
}

export function listContentCourses(): CourseSummary[] {
  if (!fs.existsSync(CONTENT_ROOT)) return [];
  const courses: CourseSummary[] = [];
  for (const dir of fs.readdirSync(CONTENT_ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const course = loadContentCourse(dir.name);
    if (course) courses.push(course);
  }
  return courses;
}

export function loadContentCourse(courseSlug: string): CourseSummary | null {
  const yamlPath = path.join(CONTENT_ROOT, courseSlug, "course.yaml");
  if (!fs.existsSync(yamlPath)) return null;
  const meta = YAML.parse(fs.readFileSync(yamlPath, "utf8")) as CourseYaml;
  const problemsDir = path.join(CONTENT_ROOT, courseSlug, "problems");
  const order = meta.problems ?? (fs.existsSync(problemsDir) ? fs.readdirSync(problemsDir).sort() : []);
  const problems: ProblemSummary[] = [];
  for (const slug of order) {
    const summary = loadContentProblemSummary(courseSlug, slug);
    if (summary) problems.push(summary);
  }
  return {
    slug: courseSlug,
    title: meta.title ?? courseSlug,
    description: meta.description ?? "",
    source: "content",
    problems,
  };
}

function problemDir(courseSlug: string, slug: string): string {
  return path.join(CONTENT_ROOT, courseSlug, "problems", slug);
}

function loadContentProblemSummary(courseSlug: string, slug: string): ProblemSummary | null {
  const yamlPath = path.join(problemDir(courseSlug, slug), "problem.yaml");
  if (!fs.existsSync(yamlPath)) return null;
  const meta = YAML.parse(fs.readFileSync(yamlPath, "utf8")) as ProblemYaml;
  return {
    courseSlug,
    slug,
    key: `${courseSlug}/${slug}`,
    title: meta.title ?? slug,
    difficulty: meta.difficulty ?? "medium",
    tags: meta.tags ?? [],
    source: "content",
  };
}

export function loadContentProblem(courseSlug: string, slug: string): ProblemDetail | null {
  const dir = problemDir(courseSlug, slug);
  const summary = loadContentProblemSummary(courseSlug, slug);
  if (!summary) return null;
  const meta = YAML.parse(fs.readFileSync(path.join(dir, "problem.yaml"), "utf8")) as ProblemYaml;
  const statementPath = path.join(dir, "statement.md");
  return {
    ...summary,
    statementMd: fs.existsSync(statementPath) ? fs.readFileSync(statementPath, "utf8") : "",
    starter: readDirAsFileMap(path.join(dir, "starter")),
    tests: readDirAsFileMap(path.join(dir, "tests")),
    machine: normalizeMachine(meta.machine),
  };
}
