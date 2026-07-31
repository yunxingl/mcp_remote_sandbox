// Validate everything under content/: run with `npm run content:check`.
// Checks course.yaml problem lists, required files, and machine specs.

import { listContentCourses, loadContentProblem } from "../lib/content";

let errors = 0;
const err = (msg: string) => {
  errors++;
  console.error(`✗ ${msg}`);
};

const courses = listContentCourses();
if (courses.length === 0) console.warn("no courses found under content/courses/");

for (const course of courses) {
  console.log(`course: ${course.slug} (${course.problems.length} problems)`);
  for (const summary of course.problems) {
    const p = loadContentProblem(course.slug, summary.slug);
    if (!p) {
      err(`${summary.key}: listed in course.yaml but problem.yaml missing`);
      continue;
    }
    if (!p.statementMd.trim()) err(`${p.key}: statement.md is missing or empty`);
    if (Object.keys(p.starter).length === 0) err(`${p.key}: no starter files`);
    if (!p.tests["run_tests.py"]) err(`${p.key}: tests/run_tests.py is required`);
    if (p.machine.timeoutSec <= 0) err(`${p.key}: machine.timeoutSec must be positive`);
    if (p.tests["run_tests.py"] && !p.tests["run_tests.py"].includes("labbench")) {
      console.warn(`  ⚠ ${p.key}: run_tests.py does not import the labbench harness`);
    }
    console.log(`  ✓ ${p.key}`);
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s)`);
  process.exit(1);
}
console.log("\ncontent OK");
