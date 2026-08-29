import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import RosterView from "@/components/RosterView";

export const dynamic = "force-dynamic";

export default async function AthletesPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <RosterView />
    </div>
  );
}
