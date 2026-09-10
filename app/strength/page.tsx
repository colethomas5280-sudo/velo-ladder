import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import StrengthView from "@/components/StrengthView";

export const dynamic = "force-dynamic";

export default async function StrengthPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <StrengthView />
    </div>
  );
}
