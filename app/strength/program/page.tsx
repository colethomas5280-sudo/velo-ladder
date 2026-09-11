import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import ProgramView from "@/components/ProgramView";

export const dynamic = "force-dynamic";

export default async function ProgramPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  const { cycle } = await searchParams;
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <ProgramView cycleId={cycle} />
    </div>
  );
}
