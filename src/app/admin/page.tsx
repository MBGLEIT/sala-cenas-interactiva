import AdminDashboard from "@/components/admin-dashboard";
import AdminLoginForm from "@/components/admin-login-form";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { fetchAdminEvents, fetchAdminPanelData } from "@/lib/admin-panel";

export const dynamic = "force-dynamic";

type AdminPageProps = {
  searchParams?: {
    eventoId?: string;
  };
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  if (!isAdminAuthenticated()) {
    return <AdminLoginForm />;
  }

  const events = await fetchAdminEvents();
  const requestedEventId = searchParams?.eventoId;
  const selectedEvent =
    events.find((eventItem) => eventItem.id === requestedEventId) ?? events[0] ?? null;

  const panelData = selectedEvent
    ? await fetchAdminPanelData(selectedEvent.id)
    : null;

  return (
    <AdminDashboard
      events={events}
      selectedEventId={selectedEvent?.id ?? null}
      panelData={panelData}
    />
  );
}
