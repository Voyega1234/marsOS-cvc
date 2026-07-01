import type { Metadata } from "next";
import { Inter, Sarabun } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const sarabun = Sarabun({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sarabun",
  display: "swap",
});
import { Toaster } from "sonner";
import { UIModeProvider } from "@/contexts/UIModeContext";
import { SessionProvider } from "@/components/layout/SessionProvider";
import { MarsProvider } from "@/lib/context/mars-context";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: { template: "%s | Mars", default: "Mars" },
  description: "เขียน SEO content ที่ติด Google — อัตโนมัติ",
};

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="th" suppressHydrationWarning className={`${inter.variable} ${sarabun.variable}`}>
      <head>
        {GTM_ID && (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`,
            }}
          />
        )}
      </head>
      <body className="min-h-screen bg-background antialiased" style={{ fontFamily: "var(--font-inter), var(--font-sarabun), system-ui, sans-serif" }}>
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
              <Toaster position="top-right" richColors closeButton />
            </UIModeProvider>
          </MarsProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
