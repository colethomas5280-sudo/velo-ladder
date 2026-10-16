import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { emailConfigured } from "@/lib/email";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const session = await auth();
  if (session?.user) redirect("/");
  return (
    <div className="login-wrap">
      <ForgotPasswordForm available={emailConfigured()} />
    </div>
  );
}
