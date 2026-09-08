"use client";

import { cn } from "@/lib/utils";
import { Folder, FolderGit2, PanelLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { AddFolderDialog } from "@/features/workspace/AddFolderDialog";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { asterTheme } from "@/lib/theme";
import { Button } from "../ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/Tooltip";

interface AppSidebarProps {
  isExpanded: boolean;
  onToggle: () => void;
}

export function AppSidebar({ isExpanded, onToggle }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme } = useTheme();
  const { workspaces, attached, attach, create, remove, status, error } =
    useWorkspace();
  const [addOpen, setAddOpen] = useState(false);
  const wordmark =
    theme === "dark" ? "/assets/aster-dark.svg" : "/assets/aster-light.svg";

  const selectProject = (id: string) => {
    attach(id);
    if (pathname !== "/") router.push("/");
  };

  return (
    <aside
      className={cn(
        "bg-sidebar/90 border-sidebar-border z-40 flex h-screen flex-col border-r backdrop-blur-md transition-all duration-300",
        isExpanded ? "w-56" : "w-16",
      )}
    >
      <div
        className={cn(
          "border-sidebar-border flex items-center gap-2 border-b px-3 py-4",
          isExpanded ? "justify-between" : "justify-center",
        )}
      >
        {isExpanded ? (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <Link href="/" className="flex min-w-0 items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={wordmark}
                  alt={asterTheme.name}
                  className="h-6 w-auto"
                />
              </Link>
            </div>

            <div className="flex items-center gap-1">
              <Button variant="icon" onClick={onToggle}>
                <PanelLeft className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Link href="/" className="flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/logo.svg"
                alt={asterTheme.name}
                className="h-5 w-5"
              />
            </Link>
            <Button variant="icon" onClick={onToggle}>
              <PanelLeft className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div className={cn("px-3 py-3", !isExpanded && "flex justify-center")}>
        {isExpanded ? (
          <Link href="/">
            <Button variant="outline" className="w-full gap-2">
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
          </Link>
        ) : (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link href="/">
                <Button variant="icon" className="bg-muted/5 rounded-full">
                  <Plus className="h-4 w-4" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">New Chat</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        {isExpanded ? (
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-sidebar-foreground">
              Projects
            </p>
            <Button
              variant="icon"
              size="sm"
              className="h-7 w-7"
              title="Choose in Finder"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="mb-2 flex justify-center">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="icon"
                  size="sm"
                  className="h-8 w-8"
                  onClick={() => setAddOpen(true)}
                >
                  <Folder className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Choose in Finder</TooltipContent>
            </Tooltip>
          </div>
        )}

        {isExpanded && status === "error" && error && (
          <p className="mb-2 px-1 text-[11px] text-rose-600">{error}</p>
        )}
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {workspaces.map((ws) => {
            const isAttached = attached?.id === ws.id;
            const row = (
              <div
                className={cn(
                  "group flex w-full items-center gap-1 rounded-lg text-sm",
                  isAttached
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/70",
                  !isExpanded && "justify-center",
                )}
              >
                <button
                  type="button"
                  onClick={() => selectProject(ws.id)}
                  className={cn(
                    "min-w-0 flex-1 truncate px-2 py-1.5 text-left",
                    !isExpanded && "flex justify-center px-0",
                  )}
                >
                  {isExpanded ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <FolderGit2 className="h-4 w-4 shrink-0" />
                      <span className="truncate">{ws.name}</span>
                    </span>
                  ) : (
                    <FolderGit2 className="h-4 w-4" />
                  )}
                </button>
                {isExpanded && (
                  <button
                    type="button"
                    className="mr-1 hidden shrink-0 rounded p-0.5 text-muted hover:text-rose-600 group-hover:inline-flex"
                    onClick={() => void remove(ws.id)}
                    aria-label={`Remove ${ws.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            );

            if (isExpanded) return <div key={ws.id}>{row}</div>;
            return (
              <Tooltip key={ws.id} delayDuration={0}>
                <TooltipTrigger asChild>{row}</TooltipTrigger>
                <TooltipContent side="right">{ws.name}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <AddFolderDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreate={async (name, path) => {
          await create({ name, path });
          if (pathname !== "/") router.push("/");
        }}
      />
    </aside>
  );
}
