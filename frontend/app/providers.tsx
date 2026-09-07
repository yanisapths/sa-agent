"use client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ThemeProvider } from "@/components/theme-provider";
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
      <WorkspaceProvider>
        <DashboardLayout>{children}</DashboardLayout>
      </WorkspaceProvider>
    </ThemeProvider>
  );
};
