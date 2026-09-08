import { Coins, Link2, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TraceKind = "chain" | "tool" | "model";

const STYLE: Record<TraceKind, { Icon: LucideIcon; className: string }> = {
  chain: {
    Icon: Link2,
    className: "bg-sky-600 text-white",
  },
  tool: {
    Icon: Wrench,
    className: "bg-emerald-600 text-white",
  },
  model: {
    Icon: Sparkles,
    className: "bg-orange-500 text-white",
  },
};

export function TraceIcon({
  kind,
  className,
}: {
  kind: TraceKind;
  className?: string;
}) {
  const { Icon, className: tone } = STYLE[kind];
  return (
    <span
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
        tone,
        className,
      )}
      aria-hidden
    >
      <Icon className="h-3 w-3" strokeWidth={2.25} />
    </span>
  );
}

export function TokenIcon({ className }: { className?: string }) {
  return <Coins className={cn("h-3 w-3 text-muted", className)} aria-hidden />;
}

export function isModelTrace(name: string, ns: string[] = []): boolean {
  return /model_request|ChatOpenAI|ChatAnthropic|ChatOllama/i.test(
    `${name} ${ns.join(" ")}`,
  );
}
