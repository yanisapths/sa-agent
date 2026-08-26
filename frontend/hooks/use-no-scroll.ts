"use client";
import { useEffect } from "react";

export function useNoScroll(active: boolean) {
  useEffect(() => {
    const html = document.documentElement;
    if (active) {
      html.classList.add("no-scroll");
    } else {
      html.classList.remove("no-scroll");
    }

    return () => html.classList.remove("no-scroll");
  }, [active]);
}
