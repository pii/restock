"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  ChevronsUpDownIcon,
  CircleCheckIcon,
  CircleOffIcon,
  CirclePauseIcon,
  LogOutIcon,
  PackageCheckIcon,
  PackageIcon,
  SettingsIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import type { StoreInfo } from "@/lib/stores";
import { logoutAction } from "./actions";

export type SidebarCounts = {
  total: number;
  available: number;
  unavailable: number;
  paused: number;
  byStore: Record<string, number>;
};

export function AppSidebar({
  username,
  stores,
  counts,
}: {
  username: string;
  stores: StoreInfo[];
  counts: SidebarCounts;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const onProducts = pathname === "/";
  const status = params.get("status");
  const store = params.get("store");

  const views = [
    { title: "All products", href: "/", icon: PackageIcon, count: counts.total, active: onProducts && !status && !store },
    { title: "Available", href: "/?status=available", icon: CircleCheckIcon, count: counts.available, active: onProducts && status === "available" && !store },
    { title: "Unavailable", href: "/?status=unavailable", icon: CircleOffIcon, count: counts.unavailable, active: onProducts && status === "unavailable" && !store },
    { title: "Paused", href: "/?status=paused", icon: CirclePauseIcon, count: counts.paused, active: onProducts && status === "paused" && !store },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <PackageCheckIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Restock</span>
                  <span className="truncate text-xs text-muted-foreground">Stock alerts</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Products</SidebarGroupLabel>
          <SidebarMenu>
            {views.map((v) => (
              <SidebarMenuItem key={v.title}>
                <SidebarMenuButton asChild isActive={v.active} tooltip={v.title}>
                  <Link href={v.href}>
                    <v.icon />
                    <span>{v.title}</span>
                  </Link>
                </SidebarMenuButton>
                <SidebarMenuBadge className="tabular-nums">{v.count}</SidebarMenuBadge>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Stores</SidebarGroupLabel>
          <SidebarMenu>
            {stores.map((s) => (
              <SidebarMenuItem key={s.id}>
                <SidebarMenuButton asChild isActive={onProducts && store === s.id} tooltip={s.name}>
                  <Link href={`/?store=${s.id}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
                    <img src={s.logo} alt="" width={16} height={16} className="size-4 shrink-0 rounded-[3px]" />
                    <span>{s.name}</span>
                  </Link>
                </SidebarMenuButton>
                <SidebarMenuBadge className="tabular-nums">{counts.byStore[s.id] ?? 0}</SidebarMenuBadge>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser username={username} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function NavUser({ username }: { username: string }) {
  const { isMobile } = useSidebar();
  const pathname = usePathname();
  const [signingOut, startSignOut] = useTransition();
  const initial = username.slice(0, 1).toUpperCase();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              isActive={pathname.startsWith("/settings")}
              aria-label={`Account menu for ${username}`}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg text-xs font-semibold">{initial}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{username}</span>
                <span className="truncate text-xs text-muted-foreground">Administrator</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{username}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <SettingsIcon />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={signingOut} onSelect={() => startSignOut(() => logoutAction())}>
              <LogOutIcon />
              {signingOut ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
