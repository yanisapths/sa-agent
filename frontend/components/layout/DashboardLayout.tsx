"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

import { ChatInterface } from "@/components/chat-interface";
import { cn } from "@/lib/utils";
import { AppSidebar } from "./AppSideBar";
import { AppTabs } from "./AppTabs";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const pathname = usePathname();
  const isChat = pathname === "/";
  const isVault = pathname.startsWith("/vault");
  const isArtifacts = pathname.startsWith("/artifacts");
  const isWorkflow = pathname.startsWith("/workflow");
  const [keepChat, setKeepChat] = useState(isChat);
  if (isChat && !keepChat) {
    setKeepChat(true);
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-transparent text-foreground">
      <AppSidebar
        isExpanded={sidebarExpanded}
        onToggle={() => setSidebarExpanded(!sidebarExpanded)}
      />

      <main className="flex h-screen min-h-0 flex-1 flex-col overflow-hidden">
        <AppTabs />
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {keepChat && (
            <div
              className={cn("h-full w-full", !isChat && "hidden")}
              aria-hidden={!isChat}
              inert={!isChat ? true : undefined}
            >
              <ChatInterface />
            </div>
          )}
          {isVault || isArtifacts || isWorkflow ? (
            <div className="h-full">{children}</div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
