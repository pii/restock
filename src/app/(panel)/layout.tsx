import Link from "next/link";
import { cookies } from "next/headers";
import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireUser } from "@/lib/auth";
import { listStores, storeInfo } from "@/lib/stores";
import { listTrackers } from "@/lib/trackers";
import { AppSidebar, type SidebarCounts } from "./app-sidebar";
import { SiteHeader } from "./site-header";

function sidebarCounts(): SidebarCounts {
  const counts: SidebarCounts = { total: 0, available: 0, unavailable: 0, paused: 0, byStore: {} };
  for (const t of listTrackers()) {
    counts.total++;
    counts.byStore[t.storeId] = (counts.byStore[t.storeId] ?? 0) + 1;
    if (!t.enabled) counts.paused++;
    else if (t.available) counts.available++;
    else counts.unavailable++;
  }
  return counts;
}

export default async function PanelLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const stores = listStores().map(storeInfo);
  // The sidebar component remembers its open/collapsed state in this cookie.
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar username={user.username} stores={stores} counts={sidebarCounts()} />
      <SidebarInset>
        <SiteHeader storeNames={Object.fromEntries(stores.map((s) => [s.id, s.name]))} />
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          {user.isDefaultPassword ? (
            <Alert className="border-status-warn/30 bg-status-warn-bg text-status-warn">
              <TriangleAlertIcon />
              <AlertTitle>You&apos;re using the default password</AlertTitle>
              <AlertDescription className="text-status-warn/90">
                <p>
                  Anyone who knows it can sign in.{" "}
                  <Link href="/settings#account" className="font-medium underline underline-offset-4">
                    Change it in Settings
                  </Link>
                </p>
              </AlertDescription>
            </Alert>
          ) : null}
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
