"use client";

import { useState } from "react";

import { AppSidebar } from "./AppSideBar";
import { AppTabs } from "./AppTabs";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#fbfaf9]">
      <AppSidebar
        isExpanded={sidebarExpanded}
        onToggle={() => setSidebarExpanded(!sidebarExpanded)}
      />

      <main className="flex h-screen min-h-0 flex-1 flex-col overflow-hidden">
        <AppTabs />
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </main>
    </div>
  );
}
