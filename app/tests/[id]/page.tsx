import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import AthleteTests from "@/components/AthleteTests";

export const dynamic = "force-dynamic";

export default async function AthleteTestsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  const { id } = await params;
  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <AthleteTests athleteId={id} />
    </div>
  );
}
