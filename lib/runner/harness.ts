// The python test harness injected into every sandbox as `labbench.py`.
//
// Problem tests import it:
//
//   from labbench import case, run
//
//   @case("softmax matches reference")
//   def test_softmax():
//       assert ...
//
//   run()
//
// `run()` prints human-readable logs plus a single machine-readable line
// (RESULTS_MARKER + json) that the runner parses into structured results.

export const RESULTS_MARKER = "___LABBENCH_RESULTS___";

export const HARNESS_FILENAME = "labbench.py";

export const HARNESS_SOURCE = `\
import json
import sys
import traceback

_cases = []


def case(name):
    """Register a test case."""
    def deco(fn):
        _cases.append((name, fn))
        return fn
    return deco


def run():
    """Run all registered cases and emit a machine-readable summary."""
    results = []
    for name, fn in _cases:
        try:
            fn()
            results.append({"name": name, "passed": True})
            print(f"PASS  {name}")
        except AssertionError as e:
            msg = str(e) or "assertion failed"
            results.append({"name": name, "passed": False, "message": msg})
            print(f"FAIL  {name}: {msg}")
        except Exception:
            tb = traceback.format_exc()
            results.append({"name": name, "passed": False, "message": tb.strip().splitlines()[-1]})
            print(f"ERROR {name}:\\n{tb}")
    summary = {
        "total": len(results),
        "passed": sum(1 for r in results if r["passed"]),
        "cases": results,
    }
    print("${RESULTS_MARKER}" + json.dumps(summary))
    sys.stdout.flush()
    ok = summary["total"] > 0 and summary["passed"] == summary["total"]
    sys.exit(0 if ok else 1)
`;
