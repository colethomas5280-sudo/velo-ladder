import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import Nutrition from "@/components/Nutrition";

export const dynamic = "force-dynamic";

export default async function NutritionPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <Nutrition />
    </div>
  );
}
