"use client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ThemeProvider } from "@/components/theme-provider";
import { useNoScroll } from "@/hooks/use-no-scroll";
import { ReactNode } from "react";

interface providersProps {
  children: ReactNode;
}

export const Providers = ({ children }: providersProps) => {
  useNoScroll(true);

  return (
    <ThemeProvider>
      <DashboardLayout>{children}</DashboardLayout>
    </ThemeProvider>
  );
};
