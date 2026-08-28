import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return <AppShell email={session.user.email} />;
}
