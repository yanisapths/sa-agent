"use client";

import { Check, ChevronsUpDown, KeyRound, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

import { CapabilityChips } from "./CapabilityChips";
import { useProduct } from "./ProductProvider";

/** One switcher per page; the tabs pill opens it through this id. */
export const SWITCHER_BUTTON_ID = "product-switcher-button";

type MenuItem =
  | { kind: "product"; id: string; name: string; isDefault: boolean }
  | { kind: "connections" }
  | { kind: "add" };

export function ProductSwitcher({ isExpanded }: { isExpanded: boolean }) {
  const { products, active, activeId, status, error, switchTo, remove, openDialog } = useProduct();
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const items: MenuItem[] = [
    ...products.map((item) => ({
      kind: "product" as const,
      id: item.id,
      name: item.name,
      isDefault: item.isDefault,
    })),
    { kind: "connections" },
    { kind: "add" },
  ];

  const name = active?.name ?? (status === "loading" ? "Loading…" : "Default");

  useEffect(() => {
    if (!open) return;
    itemRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const openMenu = () => {
    const current = items.findIndex((item) => item.kind === "product" && item.id === activeId);
    setFocusIndex(Math.max(current, 0));
    setOpen(true);
  };

  const choose = (item: MenuItem) => {
    if (item.kind === "product") switchTo(item.id);
    if (item.kind === "connections") openDialog("connections");
    if (item.kind === "add") openDialog("add");
    close();
  };

  const handleMenuKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusIndex((index) => (index + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusIndex((index) => (index - 1 + items.length) % items.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setFocusIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setFocusIndex(items.length - 1);
    } else if (event.key === "Escape" || event.key === "Tab") {
      close();
    }
  };

  const handleRemove = async (id: string, productName: string) => {
    if (!window.confirm(`Remove ${productName}? Its chats stay, but its saved connections are deleted.`)) return;
    try {
      await remove(id);
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : "Could not remove the product.");
    }
  };

  const trigger = (
    <button
      ref={buttonRef}
      id={SWITCHER_BUTTON_ID}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-label={isExpanded ? undefined : `Product: ${name}`}
      onClick={() => (open ? close() : openMenu())}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openMenu();
        }
      }}
      className={cn(
        "text-sidebar-foreground hover:bg-sidebar-accent/70 flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border text-left",
        isExpanded ? "px-2 py-1.5" : "h-9 w-9 justify-center p-0",
      )}
    >
      {isExpanded ? (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </>
      ) : (
        <span className="text-sm font-semibold">{name.slice(0, 1).toUpperCase()}</span>
      )}
    </button>
  );

  return (
    <div ref={containerRef} className="relative">
      {isExpanded ? (
        trigger
      ) : (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{name}</TooltipContent>
        </Tooltip>
      )}
      {isExpanded ? (
        <div className="mt-1.5">
          <CapabilityChips />
        </div>
      ) : null}
      {isExpanded && status === "error" && error ? (
        <p className="mt-1 text-[11px] text-rose-600">{error}</p>
      ) : null}

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={SWITCHER_BUTTON_ID}
          onKeyDown={handleMenuKey}
          className={cn(
            "absolute z-50 mt-1 w-56 rounded-xl border border-border bg-surface p-1 shadow-lg",
            isExpanded ? "left-0" : "left-10 top-0",
          )}
        >
          {items.map((item, index) => {
            const ref = (node: HTMLButtonElement | null) => {
              itemRefs.current[index] = node;
            };
            const itemClass =
              "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/10 focus:bg-muted/10 focus:outline-none";
            if (item.kind === "product") {
              const isActive = item.id === activeId;
              return (
                <div key={item.id} className="group flex items-center">
                  <button
                    ref={ref}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    tabIndex={index === focusIndex ? 0 : -1}
                    className={itemClass}
                    onClick={() => choose(item)}
                  >
                    <Check className={cn("h-3.5 w-3.5 shrink-0", !isActive && "invisible")} />
                    <span className="truncate">{item.name}</span>
                  </button>
                  {!item.isDefault ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="mr-1 hidden shrink-0 rounded p-1 text-muted hover:text-rose-600 group-hover:inline-flex"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => void handleRemove(item.id, item.name)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              );
            }
            return (
              <button
                key={item.kind}
                ref={ref}
                type="button"
                role="menuitem"
                tabIndex={index === focusIndex ? 0 : -1}
                className={cn(itemClass, item.kind === "connections" && "mt-1 border-t border-border pt-2")}
                onClick={() => choose(item)}
              >
                {item.kind === "connections" ? (
                  <KeyRound className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                )}
                {item.kind === "connections" ? "Connections…" : "Add product"}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
