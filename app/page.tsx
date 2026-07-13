import DashboardClient from "./DashboardClient";
import { requireAppOwner } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

async function ProtectedDashboard() {
  if (process.env.NODE_ENV === "development") return <DashboardClient ownerName="プレビュー" />;
  const user = await requireAppOwner("/");
  return <DashboardClient ownerName={user.fullName ?? user.email} />;
}

export default function Home() {
  return <ProtectedDashboard />;
}
