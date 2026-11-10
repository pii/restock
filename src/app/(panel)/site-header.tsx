"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

const STATUS_CRUMB: Record<string, string> = {
  available: "Available",
  unavailable: "Unavailable",
  paused: "Paused",
};

export function SiteHeader({ storeNames }: { storeNames: Record<string, string> }) {
  const pathname = usePathname();
  const params = useSearchParams();

  const crumbs: { label: string; href?: string }[] = [];
  if (pathname.startsWith("/settings")) {
    crumbs.push({ label: "Settings" });
  } else {
    const store = params.get("store");
    const status = params.get("status");
    const filter = (store && storeNames[store]) || (status && STATUS_CRUMB[status]);
    crumbs.push(filter ? { label: "Products", href: "/" } : { label: "Products" });
    if (filter) crumbs.push({ label: filter });
  }

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-center" />
      <Breadcrumb>
        <BreadcrumbList>
          {crumbs.map((c, i) => (
            <Fragment key={c.label}>
              {i > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem>
                {c.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={c.href}>{c.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{c.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
