import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { asterTheme } from "@/lib/theme";

export const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const defaultMetadata = (): Metadata => {
  return {
    title: asterTheme.name,
    icons: {
      icon: [
        { url: asterTheme.favicon.light, media: "(prefers-color-scheme: light)" },
        { url: asterTheme.favicon.dark, media: "(prefers-color-scheme: dark)" },
      ],
      shortcut: asterTheme.favicon.dark,
    },
  };
};
