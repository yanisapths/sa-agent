"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/vault", label: "Vault" },
  { href: "/", label: "Chat Agent" },
  { href: "/spec", label: "Spec Design Agent" },
] as const;

export function AppTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Workspace"
      className="flex shrink-0 gap-1 border-b border-black/15 px-4"
    >
      {tabs.map((tab) => {
        const isActive =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "border-pink-300 text-black"
                : "border-transparent text-black/60 hover:text-blackck/40",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
