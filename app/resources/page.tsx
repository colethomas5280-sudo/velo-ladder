import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import Resources from "@/components/Resources";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <Resources />
    </div>
  );
}
