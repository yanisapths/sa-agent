"use client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ThemeProvider } from "@/components/theme-provider";
import { ChatSessionProvider } from "@/features/chat-session/ChatSessionProvider";
import { ChatHistoryProvider } from "@/features/chats/ChatHistoryProvider";
import { NotificationSounds } from "@/features/workflow/useNotificationSounds";
import { WorkspaceProvider } from "@/features/workspace/WorkspaceProvider";
import { useNoScroll } from "@/hooks/use-no-scroll";
import { ReactNode } from "react";

interface providersProps {
  children: ReactNode;
}

export const Providers = ({ children }: providersProps) => {
  useNoScroll(true);

  return (
    <ThemeProvider>
      <ChatSessionProvider>
        <NotificationSounds />
        <WorkspaceProvider>
          <ChatHistoryProvider>
            <DashboardLayout>{children}</DashboardLayout>
          </ChatHistoryProvider>
        </WorkspaceProvider>
      </ChatSessionProvider>
    </ThemeProvider>
  );
};
