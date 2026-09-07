"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { QuotaMeter } from "@/components/quota-meter";
import { useQuota } from "@/hooks/use-quota";
import { ThemeToggle } from "./ThemeToggle";

const tabs = [
  { href: "/vault", label: "Vault" },
  { href: "/artifacts", label: "Artifacts" },
  { href: "/workflow", label: "Workflow" },
  { href: "/", label: "Chat Agent" },
] as const;

export function AppTabs() {
  const pathname = usePathname();
  /**
   * The gateway budget is not per-conversation, so it belongs in the chrome
   * rather than in the chat. This reads it on mount; `ChatInterface` refreshes
   * its own copy after each turn.
   */
  const { quota } = useQuota();

  return (
    <nav
      aria-label="Workspace"
      className="flex shrink-0 gap-1 border-b border-border px-4"
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
                ? "border-pink-300 text-foreground"
                : "border-transparent text-foreground/60 hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}

      <div className="ml-auto flex items-center gap-1">
        <QuotaMeter quota={quota} />
        <ThemeToggle />
      </div>
    </nav>
  );
}
