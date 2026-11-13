import type { Metadata } from "next";
import { Urbanist, Anuphan, Sarabun } from "next/font/google";
import "./globals.css";

// UI: Urbanist (Latin) + Anuphan (ไทย). Sarabun คงไว้ให้ .article-preview ใช้
const urbanist = Urbanist({
  subsets: ["latin"],
  variable: "--font-urbanist",
  display: "swap",
});

const anuphan = Anuphan({
  subsets: ["thai", "latin"],
  variable: "--font-thai",
  display: "swap",
});

const sarabun = Sarabun({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sarabun",
  display: "swap",
});
import { ThemeRuntime } from "@/components/layout/theme";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { UIModeProvider } from "@/contexts/UIModeContext";
import { SessionProvider } from "@/components/layout/SessionProvider";
import { MarsProvider } from "@/lib/context/mars-context";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: { template: "%s | MarsOS", default: "MarsOS" },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  description: "เขียน SEO content ที่ติด Google — อัตโนมัติ",
};

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="th" suppressHydrationWarning className={`${urbanist.variable} ${anuphan.variable} ${sarabun.variable}`}>
      <head>
        {/* โหมดมืด: ใส่ class ก่อนวาดหน้า กันจอกะพริบ (ค่าตั้งต้น = สว่าง) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {GTM_ID && (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`,
            }}
          />
        )}
      </head>
      <body className="min-h-screen antialiased" style={{ fontFamily: "var(--font-urbanist), var(--font-thai), var(--font-sarabun), system-ui, sans-serif" }}>
        {GTM_ID && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
              height="0" width="0"
              style={{ display: "none", visibility: "hidden" }}
            />
          </noscript>
        )}
        <SessionProvider session={session}>
          <MarsProvider>
            <UIModeProvider>
              {children}
              <ThemeRuntime />
            </UIModeProvider>
          </MarsProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
