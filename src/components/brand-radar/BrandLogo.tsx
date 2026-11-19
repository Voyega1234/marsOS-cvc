"use client";

/**
 * Brand Radar — a brand's picture: the logo the team uploaded, else the site favicon, else initials.
 * A logo value comes from the API (and from settings a person typed), so it is checked before it reaches <img src>.
 */
import { useState } from "react";
import { EntityAvatar } from "@/components/ds";

/** Only https URLs or same-origin paths (single leading slash) may reach an <img src>. */
export function safeLogoSrc(logo: string | null | undefined): string | undefined {
  if (!logo) return undefined;
  if (logo.startsWith("https://")) return logo;
  if (logo.startsWith("/") && !logo.startsWith("//") && !logo.startsWith("/\\")) return logo;
  return undefined;
}

/** Favicon of a public website, null when the text is not a plain hostname. Same source the backlink report uses. */
export function domainFavicon(domain: string | null | undefined): string | null {
  const raw = (domain ?? "").trim().toLowerCase();
  if (!raw) return null;
  let host = "";
  try {
    host = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export function BrandLogo({ name, logo, favicon, size = 40, color, rounded = "rounded-2xl" }: {
  name: string;
  logo?: string | null;
  favicon?: string | null;
  size?: number;
  color?: string;
  rounded?: string;
}) {
  // sources that failed to load in this browser; the next one in line is tried, then initials
  const [bad, setBad] = useState<string[]>([]);
  const sources = [safeLogoSrc(logo), safeLogoSrc(favicon)].filter((s): s is string => !!s);
  const src = sources.find((s) => !bad.includes(s));
  if (!src) return <EntityAvatar label={name} color={color} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBad((b) => (b.includes(src) ? b : [...b, src]))}
      className={`shrink-0 bg-white object-contain ${rounded}`}
      style={{ width: size, height: size }}
    />
  );
}
