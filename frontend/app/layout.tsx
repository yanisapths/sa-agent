import { headers } from "next/headers";
import "./globals.css";
import { geistMono, geistSans, defaultMetadata } from "@/components/metadata";
import { asterTheme } from "@/lib/theme";
import { Providers } from "./providers";

export const metadata = defaultMetadata();

const themeScript = `(function(){try{var s=localStorage.getItem("sa-theme");var t=s==="dark"||s==="light"?s:"${asterTheme.appearance.default}";document.documentElement.classList.toggle("dark",t==="dark");}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") || undefined;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased${asterTheme.background.decoration === "gradient" ? " theme-gradient" : ""}`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* Browsers hide nonce from the DOM; without this, React reports a hydration mismatch. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        <div className="relative z-1 flex min-h-full flex-1 flex-col">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
