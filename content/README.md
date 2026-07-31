# Authoring content

Courses live in `content/courses/<course-slug>/`:

```
content/courses/cs336-mini/
  course.yaml                     # title, description, ordered problem list
  problems/
    bpe-tokenizer/
      problem.yaml                # title, difficulty, tags, machine spec
      statement.md                # multi-part statement (markdown + KaTeX $...$)
      starter/                    # files shown in the editor (any number, nested ok)
        bpe.py
      tests/                      # copied into the sandbox over the user's files
        run_tests.py              # REQUIRED entrypoint
```

## problem.yaml

```yaml
title: "Byte-Pair Encoding"
difficulty: easy | medium | hard
tags: [tokenization, nlp]
machine:
  backend: auto        # auto | local | modal
  image: python:3.11-slim
  gpu: none            # none | T4 | L4 | A10G | A100 | H100  (modal only)
  cpu: 2
  memoryMb: 4096
  pip: [torch]         # installed in the sandbox before running (modal only)
  timeoutSec: 300
```

## Tests

`run_tests.py` uses the injected `labbench` harness:

```python
from labbench import case, run
from student_module import thing

@case("thing works on the basic example")
def test_basic():
    assert thing(1) == 2, f"expected 2, got {thing(1)}"

run()
```

Test files are copied into the sandbox *after* user files, so users can never
overwrite a test. Tests are not visible in the editor or over MCP.

Content is read from disk on every request — edit, refresh, done.
