# 🧪 LabBench

A personal platform for learning ML & systems by building — host entire courses
(CS336-style problem sets), write multi-file solutions in the browser, run tests
in sandboxes with arbitrary machine types, and get help from Claude both in-site
and from Claude Code over MCP.

## What it does

- **Problem-set style problems** — each problem has a multi-part markdown
  statement (KaTeX math supported) in a sidebar, closer to a pset than a
  LeetCode prompt. Courses are just directories of markdown + yaml in
  `content/` (see `content/README.md`).
- **Multi-file editor** — Monaco-based workspace on the right: create/delete
  files, autosave, Cmd/Ctrl+S. Python + PyTorch out of the box; the runner
  itself is language-agnostic (anything the sandbox image can execute).
- **Sandboxed test runs** — hit *Run tests* and the platform executes the
  problem's `run_tests.py` against your files in a sandbox and renders
  per-case results + logs in the sidebar. Two backends:
  - `local`: subprocess on the server (dev, stdlib-only problems)
  - `modal`: [Modal Sandboxes](https://modal.com/docs/guide/sandbox) with
    per-problem machine specs — image, cpu, memory, **GPUs** (T4…H100), and
    pip packages like `torch`
- **Google login, allowlist-only** — only emails in `ALLOWED_EMAILS` can sign in.
- **One shared MCP endpoint** (`/api/mcp`) for Claude Code *and* claude.ai
  (built-in OAuth 2.1 server, so it works as a claude.ai custom connector):
  | tool | what it does |
  | --- | --- |
  | `list_problems` / `get_problem` | browse all coursework |
  | `get_workspace` / `get_run` | read your current files, runs, logs |
  | `run_tests` | kick off a sandbox run |
  | `post_hint` | drop a hint into the problem's chat sidebar |
  | `assign_task` | assign you a brand-new project (statement + starter + tests), shows up under "Assigned by Claude" |
  | `update_task` | revise an assigned task — statement, files (merged by path), machine spec, difficulty, tags |
- **In-site tutor chat** — per-problem Claude chat that sees the statement,
  your files, and your latest test run. MCP hints land in the same thread.

## Setup

```bash
npm install
cp .env.example .env   # then fill it in
npx prisma db push     # create tables
npm run dev
```

You need:

1. **Postgres** — any `DATABASE_URL` (Neon / Supabase / Vercel Postgres / local).
2. **Google OAuth** — create an OAuth client at
   [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials),
   authorized redirect URI `https://<your-domain>/api/auth/callback/google`
   (or `http://localhost:3000/...` for dev). Put the id/secret in
   `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, and set `AUTH_SECRET`
   (`openssl rand -base64 32`).
3. **`ALLOWED_EMAILS`** — your email. Nobody else can log in.

Optional:

4. **OpenRouter** — `OPENROUTER_KEY` (from [openrouter.ai/keys](https://openrouter.ai/keys))
   enables the in-site tutor chat; `OPENROUTER_MODEL` picks the model
   (any OpenRouter id, e.g. `anthropic/claude-sonnet-4.5`).
5. **Modal** — `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`
   (from [modal.com/settings/tokens](https://modal.com/settings/tokens))
   enables cloud sandboxes with GPUs and pip installs. With
   `RUNNER_BACKEND=auto`, problems run on Modal when it's configured and
   locally otherwise; per-problem `machine.backend` overrides.
6. **`MCP_TOKEN`** — `openssl rand -hex 32`; static bearer token for the MCP
   endpoint (used by Claude Code). OAuth clients like claude.ai don't need it.

### Deploying (Vercel)

Push this repo, import into Vercel, set the env vars above. `npm run build`
runs `prisma generate` automatically; run `npx prisma db push` against your
production DB once. The MCP endpoint and OAuth need the public URL, so set the
Google redirect URI accordingly.

### Connecting Claude Code (MCP)

```bash
claude mcp add --transport http labbench https://<your-domain>/api/mcp \
  --header "Authorization: Bearer <MCP_TOKEN>"
```

Then, in any Claude Code session:

- *"Look at my workspace for cs336-mini/micrograd and give me a hint about the
  failing test"* → Claude uses `get_workspace`/`get_run`, posts via `post_hint`.
- *"Assign me a small project about building a compiler"* → Claude uses
  `assign_task`; the task appears on your dashboard under **Assigned by
  Claude**, complete with starter files and tests.

With the static token, the MCP server acts on behalf of the first email in
`ALLOWED_EMAILS` (sign in once on the site before using MCP so the user row
exists).

### Connecting claude.ai / Claude Desktop (OAuth)

The app is also an OAuth 2.1 authorization server implementing the
[MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
— discovery (`/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource`), dynamic client registration
(`/api/oauth/register`), PKCE, refresh-token rotation and revocation. Login is
the site's Google sign-in, so only allowlisted emails can approve a client.

In claude.ai: **Settings → Connectors → Add custom connector**, paste
`https://<your-domain>/api/mcp`, and approve on the consent screen. Tools then
act as *you* (the user who approved), not the `ALLOWED_EMAILS` default.

## Authoring courses

See [`content/README.md`](content/README.md). Short version:

```
content/courses/<course>/course.yaml
content/courses/<course>/problems/<slug>/{problem.yaml,statement.md,starter/,tests/}
```

`tests/run_tests.py` uses the injected harness:

```python
from labbench import case, run

@case("part (a): thing works")
def test_thing():
    assert thing() == 42

run()
```

Validate with `npm run content:check`. The sample course **CS336-mini** ships
three problems: a BPE tokenizer, a micrograd-style autograd engine (both run
anywhere, stdlib-only), and attention-from-scratch in PyTorch (machine spec
installs `torch`; give it a GPU by editing `problem.yaml`).

## Architecture notes

- Next.js 15 App Router + Prisma/Postgres + NextAuth v5 (Google, JWT sessions). Tutor chat via OpenRouter.
- File-based content is read fresh from disk per request — edit markdown,
  refresh. DB-backed problems (from `assign_task`) merge into the same catalog
  under the virtual `assigned` course.
- Runs: `POST /api/runs` snapshots your files into a `Run` row, executes via
  `next/server after()` (works on Vercel), client polls `GET /api/runs/:id`.
  Test files are copied into the sandbox *after* user files, so tests can't be
  overwritten; they're never exposed in the UI or over MCP.
- The results protocol is one marker line of JSON printed by the harness —
  language-agnostic, so future non-Python runners only need to print the same
  line.

