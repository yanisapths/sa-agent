"use client";

import { cn } from "@/lib/utils";
import { PanelLeft, Plus, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "../ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/Tooltip";

const mainNavItems = [
  // { title: 'History', url: '/history', icon: Clock },
  // { title: 'Vault', url: '/vault', icon: FolderLock },
  // { title: 'Library', url: '/library', icon: BookOpen },
  // { title: 'Guidance', url: '/guidance', icon: Compass },
];

const bottomNavItems = [
  // { title: 'Settings', url: '/dashboard', icon: Settings },
  // { title: 'Help', url: '/dashboard', icon: HelpCircle },
];

interface AppSidebarProps {
  isExpanded: boolean;
  onToggle: () => void;
}

export function AppSidebar({ isExpanded, onToggle }: AppSidebarProps) {
  const pathname = usePathname();
  const isActive = (path: string) => pathname === path;

  const NavItem = ({
    // item,
    showLabel,
  }: {
    // item: (typeof mainNavItems)[0];
    showLabel: boolean;
  }) => {
    //     const content = (
    //       <Link
    //         href={item.url}
    //         className={cn(
    //           "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
    //           "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    //           isActive(item.url) &&
    //             "bg-sidebar-accent text-sidebar-accent-foreground",
    //         )}
    //       >
    //         <item.icon className="h-5 w-5 shrink-0" />
    //         {showLabel && <span className="truncate">{item.title}</span>}
    //       </Link>
    //     );
    //     if (!showLabel) {
    //       return (
    //         <Tooltip delayDuration={0}>
    //           <TooltipTrigger asChild>{content}</TooltipTrigger>
    //           <TooltipContent side="right">{item.title}</TooltipContent>
    //         </Tooltip>
    //       );
    //     }
    //     return content;
  };

  return (
    <aside
      className={cn(
        "bg-sidebar border-sidebar-border z-40 flex h-screen flex-col border-r transition-all duration-300",
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
            <div className="flex items-center gap-2">
              <Link href="/" className="hover:shadow-xl">
                <SparklesIcon />
              </Link>
            </div>

            <div className="flex items-center gap-1">
              <Button variant="icon" onClick={onToggle}>
                <PanelLeft className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : (
          <Button variant="icon" onClick={onToggle}>
            <PanelLeft className="h-4 w-4" />
          </Button>
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
                <Button variant="icon" className="bg-[#716D65]/5 rounded-full">
                  <Plus className="h-4 w-4" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">New Chat</TooltipContent>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}
