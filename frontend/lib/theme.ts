export const grdwTheme = {
  theme: "grdw",
  name: "New chat - GRDW",
  colors: {
    primary: "#2E2E2E",
    secondary: "#EFEFEF",
    background: "#FFFFFF",
    hover: "#000000",
    accentFrom: "#81E6FF",
    accentTo: "#F081FF",
  },
  appearance: {
    default: "dark" as const,
  },
  background: {
    decoration: "gradient" as const,
  },
  favicon: {
    light: "/assets/favicon-light.svg",
    dark: "/assets/favicon-dark.svg",
  },
} as const;

export type GrdwTheme = typeof grdwTheme;
export type Appearance = GrdwTheme["appearance"]["default"];
