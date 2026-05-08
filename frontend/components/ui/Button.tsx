import * as React from "react";
import { Button as RadixButton } from "@radix-ui/themes/components/button";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "icon"
  | "outline";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends Omit<
  React.ComponentPropsWithoutRef<typeof RadixButton>,
  "variant" | "size"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: React.ReactNode;
}

const base = [
  "inline-flex items-center justify-center gap-2",
  "font-medium rounded-xl",
  "transition-all duration-200 ease-out",
  "cursor-pointer select-none",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
  "disabled:opacity-50 disabled:pointer-events-none",
  "active:scale-[0.97]",
].join(" ");

const variants: Record<ButtonVariant, string> = {
  primary: [
    "bg-pink-300 text-pink-950",
    "hover:bg-pink-400",
    "focus-visible:ring-pink-400",
    "shadow-sm hover:shadow-md",
  ].join(" "),

  secondary: [
    "bg-transparent border-2 border-pink-300 text-pink-700",
    "hover:bg-pink-50",
    "focus-visible:ring-pink-300",
  ].join(" "),

  outline: [
    "shadow-none bg-transparent border border-[#716D65]/15 text-black",
    "hover:bg-[#716D65]/10",
    "focus-visible:ring-[#716D65]/50",
  ].join(" "),

  ghost: [
    "bg-transparent text-pink-700",
    "hover:bg-pink-100",
    "focus-visible:ring-pink-300",
  ].join(" "),

  destructive: [
    "bg-rose-100 text-rose-700 border border-rose-200",
    "hover:bg-rose-200",
    "focus-visible:ring-rose-400",
  ].join(" "),

  icon: [
    "text-[#121212]",
    "hover:bg-[#716D65]/15",
    "focus-visible:ring-[#716D65]/15",
    "rounded-lg",
  ].join(" "),
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-5 text-base",
};

const iconSizes: Record<ButtonSize, string> = {
  sm: "h-8 w-8 p-0",
  md: "h-9 w-9 p-0",
  lg: "h-11 w-11 p-0",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "md", className, children, ...props },
    ref,
  ) => {
    const isIcon = variant === "icon";

    return (
      <RadixButton
        ref={ref}
        variant="ghost"
        className={twMerge(
          clsx(base, variants[variant], isIcon ? iconSizes[size] : sizes[size]),
          className,
        )}
        {...props}
      >
        {children}
      </RadixButton>
    );
  },
);

Button.displayName = "Button";
