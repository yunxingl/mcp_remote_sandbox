import { redirect } from "next/navigation";
import { currentUser, signIn } from "@/lib/auth";

/** Only allow same-site relative paths as post-login destinations. */
function safeCallback(url: string | undefined): string {
  return url && url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await props.searchParams;
  const redirectTo = safeCallback(callbackUrl);
  const user = await currentUser();
  if (user) redirect(redirectTo);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-8 text-center">
        <div className="text-3xl">🧪</div>
        <h1 className="mt-3 text-2xl font-bold">LabBench</h1>
        <p className="mt-2 text-sm text-[var(--text-dim)]">
          Learn ML &amp; systems by building. Private lab — invite only.
        </p>
        {error && (
          <p className="mt-4 rounded-lg border border-[var(--red)] bg-[var(--bg-raised)] p-2 text-xs text-[var(--red)]">
            {error === "AccessDenied"
              ? "This Google account isn't on the allowlist."
              : "Sign-in failed. Try again."}
          </p>
        )}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo });
          }}
        >
          <button
            type="submit"
            className="mt-6 w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#0b0e14] transition hover:opacity-90"
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </main>
  );
}
