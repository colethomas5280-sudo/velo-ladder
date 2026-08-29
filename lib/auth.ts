import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";

function coachEmails(): string[] {
  return (process.env.COACH_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const email = String(creds?.email || "").trim().toLowerCase();
        const password = String(creds?.password || "");
        if (!email || !password) return null;

        // coach: any COACH_EMAILS address + the shared COACH_PASSWORD
        const coachPass = process.env.COACH_PASSWORD || "";
        if (coachPass && coachEmails().includes(email) && password === coachPass) {
          return { id: "coach:" + email, email, name: "Coach" };
        }

        // athlete: match invite_email + bcrypt password
        const rows = (await sql`
          SELECT id, password_hash FROM athletes
          WHERE archived = false AND lower(invite_email) = ${email}
          LIMIT 1
        `) as { id: string; password_hash: string | null }[];
        const a = rows[0];
        if (a?.password_hash && (await bcrypt.compare(password, a.password_hash))) {
          return { id: a.id, email };
        }
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.uid) session.user.id = String(token.uid);
      return session;
    },
  },
});
