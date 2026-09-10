import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import { AthleteStrength } from "@/components/StrengthView";

export const dynamic = "force-dynamic";

export default async function AthleteStrengthPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <AthleteStrength athleteId={id} />
    </div>
  );
}
