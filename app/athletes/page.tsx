import { redirect } from "next/navigation";
import { getScope } from "@/lib/scope";
import AppHeader from "@/components/AppHeader";
import AthletesTable from "@/components/AthletesTable";

export const dynamic = "force-dynamic";

export default async function AthletesPage() {
  const scope = await getScope();
  if (!scope) redirect("/login");
  if (scope.role !== "coach") redirect("/");

  return (
    <div className="wrap">
      <AppHeader />
      <AthletesTable />
    </div>
  );
}
