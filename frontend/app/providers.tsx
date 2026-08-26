"use client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useNoScroll } from "@/hooks/use-no-scroll";
import { ReactNode } from "react";

interface providersProps {
  children: ReactNode;
}

export const Providers = ({ children }: providersProps) => {
  useNoScroll(true);

  return <DashboardLayout>{children}</DashboardLayout>;
};
