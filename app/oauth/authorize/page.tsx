// OAuth authorization endpoint — the consent screen. Requires the site's
// Google login; approving mints an authorization code for the client.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  AUTHORIZE_PATH,
  AuthorizeParams,
  OAuthError,
  issueAuthorizationCode,
  redirectWith,
  validateAuthorizeRequest,
} from "@/lib/oauth";

type Search = Record<string, string | string[] | undefined>;

function flatten(sp: Search): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

function ErrorCard({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-8">
        <div className="text-3xl">🧪</div>
        <h1 className="mt-3 text-xl font-bold">Can&apos;t authorize this app</h1>
        <p className="mt-2 text-sm text-[var(--red)]">{title}</p>
        <p className="mt-2 text-xs text-[var(--text-dim)]">{detail}</p>
      </div>
    </main>
  );
}

const PERMISSIONS = [
  "Browse all courses and problem statements",
  "Read your workspace files, test runs and logs",
  "Run tests in a sandbox on your behalf",
  "Post hints into your problem chat",
  "Assign you new tasks",
];

export default async function AuthorizePage(props: { searchParams: Promise<Search> }) {
  const raw = flatten(await props.searchParams);

  // Not signed in → Google login, then come straight back here.
  const user = await currentUser();
  if (!user) {
    const qs = new URLSearchParams(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"));
    redirect(`/login?callbackUrl=${encodeURIComponent(`${AUTHORIZE_PATH}?${qs}`)}`);
  }

  let client: Awaited<ReturnType<typeof validateAuthorizeRequest>>["client"];
  let params: AuthorizeParams;
  try {
    ({ client, params } = await validateAuthorizeRequest(raw));
  } catch (e) {
    const err = e as OAuthError & { redirectable?: boolean };
    if (err instanceof OAuthError && err.redirectable && raw.redirect_uri) {
      redirect(redirectWith(raw.redirect_uri, { error: err.code, error_description: err.description, state: raw.state }));
    }
    return (
      <ErrorCard
        title={err instanceof OAuthError ? err.description : "Invalid authorization request."}
        detail="The connecting application sent a request LabBench can't honor. Nothing was granted."
      />
    );
  }

  const clientLabel = client.name || client.id;
  const redirectHost = new URL(params.redirect_uri).host;

  async function decide(formData: FormData) {
    "use server";
    const me = await currentUser();
    if (!me) redirect("/login");
    // Re-validate from the submitted fields so nothing can be swapped in between.
    const submitted: Record<string, string | undefined> = {};
    for (const k of ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"]) {
      const v = formData.get(k);
      if (typeof v === "string" && v !== "") submitted[k] = v;
    }
    const { params: p } = await validateAuthorizeRequest(submitted);
    if (formData.get("decision") !== "approve") {
      redirect(redirectWith(p.redirect_uri, { error: "access_denied", error_description: "The user denied the request", state: p.state }));
    }
    const code = await issueAuthorizationCode(me.id, p);
    redirect(redirectWith(p.redirect_uri, { code, state: p.state }));
  }

  // Signed-in user is guaranteed above (redirect() throws), but TS can't tell.
  const email = user!.email;
  await headers(); // opt into dynamic rendering explicitly

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-8">
        <div className="text-3xl">🧪</div>
        <h1 className="mt-3 text-xl font-bold">Connect to LabBench</h1>
        <p className="mt-2 text-sm text-[var(--text-dim)]">
          <span className="font-semibold text-[var(--text)]">{clientLabel}</span> wants to use the LabBench MCP
          server as <span className="font-semibold text-[var(--text)]">{email}</span>.
        </p>

        <ul className="mt-5 space-y-1.5 text-sm">
          {PERMISSIONS.map((p) => (
            <li key={p} className="flex gap-2">
              <span className="text-[var(--green)]">✓</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>

        <p className="mt-5 text-xs text-[var(--text-dim)]">
          After approving you&apos;ll be sent back to <span className="font-mono">{redirectHost}</span>.
        </p>

        <form action={decide} className="mt-6 flex gap-3">
          {(Object.entries(params) as [string, string | undefined][]).map(([k, v]) =>
            v ? <input key={k} type="hidden" name={k} value={v} /> : null
          )}
          <button
            type="submit"
            name="decision"
            value="deny"
            className="w-1/3 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-4 py-2.5 text-sm font-semibold transition hover:opacity-90"
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            className="w-2/3 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#0b0e14] transition hover:opacity-90"
          >
            Approve
          </button>
        </form>
      </div>
    </main>
  );
}
