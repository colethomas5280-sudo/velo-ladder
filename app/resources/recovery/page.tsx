import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import RecoveryGuide from "@/components/RecoveryGuide";

export const dynamic = "force-dynamic";

export default async function RecoveryGuidePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <RecoveryGuide />
    </div>
  );
}
