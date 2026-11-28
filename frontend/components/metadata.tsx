import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { grdwTheme } from "@/lib/theme";

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
    title: grdwTheme.name,
    icons: {
      icon: [
        { url: grdwTheme.favicon.light, media: "(prefers-color-scheme: light)" },
        { url: grdwTheme.favicon.dark, media: "(prefers-color-scheme: dark)" },
      ],
      shortcut: grdwTheme.favicon.dark,
    },
  };
};
