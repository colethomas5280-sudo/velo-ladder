import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import MyProfile from "@/components/MyProfile";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  const { welcome } = await searchParams;
  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <MyProfile welcome={welcome === "1"} />
    </div>
  );
}
