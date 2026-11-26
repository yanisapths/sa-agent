"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ModelPicker } from "@/components/model-picker";
import { QuotaMeter } from "@/components/quota-meter";
import { useGateway } from "@/features/gateway/GatewayProvider";
import { CapabilityChips } from "@/features/product/CapabilityChips";
import { useProduct } from "@/features/product/ProductProvider";
import { SWITCHER_BUTTON_ID } from "@/features/product/ProductSwitcher";
import { ThemeToggle } from "./ThemeToggle";

const tabs = [
  { href: "/vault", label: "Vault" },
  { href: "/artifacts", label: "Artifacts" },
  { href: "/workflow", label: "Workflow" },
  { href: "/", label: "Assistant" },
] as const;

export function AppTabs() {
  const pathname = usePathname();
  /**
   * Model choice and the virtual-key budget are gateway-wide, so they live in
   * the chrome. Chat refreshes quota after each turn through the same provider.
   */
  const { quota, quotaState, quotaError, models, model, setModel } = useGateway();
  const { active } = useProduct();

  return (
    <nav
      aria-label="Workspace"
      className="flex shrink-0 items-stretch gap-1 border-b border-border bg-surface/40 px-5 backdrop-blur-md"
    >
      <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-3 text-sm font-medium transition-colors",
              isActive
                ? "border-light text-foreground"
                : "border-transparent text-foreground/60 hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
      </div>

      <div className="ml-2 flex shrink-0 items-center gap-1">
        {active ? (
          <div className="mr-1 hidden min-w-0 max-w-[14rem] items-center gap-2 rounded-full border border-border px-2 py-1 lg:flex">
            <button
              type="button"
              className="min-w-0 cursor-pointer truncate text-xs font-medium"
              aria-label={`Product: ${active.name}. Switch product`}
              onClick={() => document.getElementById(SWITCHER_BUTTON_ID)?.click()}
            >
              {active.name}
            </button>
            <span className="hidden min-w-0 xl:flex">
              <CapabilityChips compact />
            </span>
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-1">
          <ModelPicker models={models} model={model} onModelChange={setModel} />
          <QuotaMeter quota={quota} status={quotaState} error={quotaError} />
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
