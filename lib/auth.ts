import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import PostgresAdapter from "@auth/pg-adapter";
import type { Pool as NodePgPool } from "pg";
import { createTransport } from "nodemailer";
import { pgPool } from "@/lib/db";

const EMAIL_FROM = process.env.EMAIL_FROM || "Velo Ladder <noreply@example.com>";

const smtp = {
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT || 587),
  auth:
    process.env.EMAIL_USER && process.env.EMAIL_PASS
      ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      : undefined,
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pgPool as unknown as NodePgPool),
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login", verifyRequest: "/login/verify", error: "/login" },
  providers: [
    Nodemailer({
      server: smtp,
      from: EMAIL_FROM,
      maxAge: 15 * 60, // link valid 15 minutes
      async sendVerificationRequest({ identifier: email, url }) {
        // No SMTP configured: print the link in dev, fail loudly in prod.
        if (!smtp.auth) {
          if (process.env.NODE_ENV !== "production") {
            console.log(`\n🔑  Velo Ladder sign-in link for ${email}:\n${url}\n`);
            return;
          }
          throw new Error(
            "Email is not configured — set EMAIL_USER and EMAIL_PASS.",
          );
        }
        const { host } = new URL(url);
        const transport = createTransport(smtp);
        await transport.sendMail({
          to: email,
          from: EMAIL_FROM,
          subject: `Sign in to Velo Ladder`,
          text: `Sign in to Velo Ladder\n\n${url}\n\nThis link is good for 15 minutes. If you didn't request it, ignore this email.\n`,
          html: emailHtml(url, host),
        });
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

function emailHtml(url: string, host: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0e1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0e1117;padding:40px 16px">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" style="max-width:440px;width:100%;background:#161a22;border:1px solid #282d38;border-radius:12px;overflow:hidden">
        <tr><td style="padding:28px 28px 8px">
          <div style="font-family:'Teko',sans-serif;font-size:22px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#ebe7dc">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ff7d1f;margin-right:8px;vertical-align:middle"></span>Velo&nbsp;Ladder
          </div>
        </td></tr>
        <tr><td style="padding:12px 28px 4px;color:#ebe7dc;font-size:16px;font-weight:600">Sign in to your tracker</td></tr>
        <tr><td style="padding:6px 28px 20px;color:#8b8576;font-size:13px;line-height:1.5">Tap the button below to sign in. The link works for 15 minutes.</td></tr>
        <tr><td style="padding:0 28px 28px">
          <a href="${url}" style="display:inline-block;background:#ff7d1f;color:#17120b;font-weight:700;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:8px">Open Velo Ladder</a>
        </td></tr>
        <tr><td style="padding:0 28px 26px;color:#68634f;font-size:11px;line-height:1.5;border-top:1px solid #282d38;padding-top:18px">
          If the button doesn't work, copy this link:<br><span style="color:#8b8576;word-break:break-all">${url}</span><br><br>
          Sent by ${host}. If you didn't ask to sign in, you can ignore this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
