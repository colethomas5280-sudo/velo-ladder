import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import AthleteProfile from "@/components/AthleteProfile";

export const dynamic = "force-dynamic";

export default async function AthletePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  return (
    <div className="wrap">
      <AppHeader email={session.user.email} back />
      <AthleteProfile athleteId={id} />
    </div>
  );
}
