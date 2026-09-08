export const asterTheme = {
  theme: "mint",
  name: "Aster Assistant",
  colors: {
    primary: "#177B77",
    light: "#1AE5BC",
    dark: "#165B9D",
  },
  appearance: {
    default: "dark" as const,
  },
  background: {
    decoration: "gradient" as const,
  },
  favicon: {
    light: "/logo/aster-logo.svg",
    dark: "/logo/aster-logo.svg",
  },
} as const;

export type AsterTheme = typeof asterTheme;
export type Appearance = AsterTheme["appearance"]["default"];
