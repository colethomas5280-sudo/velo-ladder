import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import ScreenReference from "@/components/ScreenReference";

export const dynamic = "force-dynamic";

export default async function ScreenReferencePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <ScreenReference />
    </div>
  );
}
