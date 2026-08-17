import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";

function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** True if this email is on the ALLOWED_EMAILS allowlist. */
export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && allowedEmails().has(email.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  providers: [Google],
  pages: { signIn: "/login" },
  callbacks: {
    // Hard allowlist: only emails in ALLOWED_EMAILS may sign in.
    signIn({ user }) {
      const email = user.email?.toLowerCase();
      return !!email && allowedEmails().has(email);
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});

/** Returns the signed-in user's { id, email } or null. */
export async function currentUser(): Promise<{ id: string; email: string } | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !allowedEmails().has(email)) return null;
  const id = session?.user?.id;
  if (!id) return null;
  return { id, email };
}

/** Like currentUser() but throws — for API routes. */
export async function requireUser(): Promise<{ id: string; email: string }> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
  }
}
