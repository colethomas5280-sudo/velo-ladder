import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import StrengthStandards from "@/components/StrengthStandards";

export const dynamic = "force-dynamic";

export default async function StandardsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <StrengthStandards />
    </div>
  );
}
