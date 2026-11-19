// Logo files in /public/logos/ai come from the npm package @lobehub/icons-static-svg@1.103.0 (MIT licence).
// The marks belong to their owners and are used only to name the AI platform they stand for.
import { isProviderKey } from "@/lib/brand-radar/types";
import { providerShort } from "./shared";

const FILE: Record<string, string> = {
  openai: "openai",
  gemini: "gemini",
  perplexity: "perplexity",
  claude: "claude",
  grok: "grok",
  deepseek: "deepseek",
  google_ai_mode: "google",
  google_ai_overview: "google",
};

const CAPTION: Record<string, string> = {
  google_ai_mode: "AI Mode",
  google_ai_overview: "Overview",
};

export function ProviderLogo({
  provider,
  size = 20,
  withName = false,
  title,
  className,
}: {
  provider: string;
  size?: number;
  withName?: boolean;
  title?: string;
  className?: string;
}) {
  const name = title ?? providerShort(provider);
  if (!isProviderKey(provider)) {
    return <span className={className} title={name}>{provider}</span>;
  }
  const caption = !withName ? CAPTION[provider] : undefined;
  return (
    <span
      className={`inline-flex items-center gap-1.5 align-middle ${className ?? ""}`}
      title={name}
      {...(withName ? {} : { role: "img", "aria-label": name })}
    >
      <span className="inline-flex shrink-0 items-center justify-center rounded-md bg-white p-0.5 ring-1 ring-black/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/logos/ai/${FILE[provider]}.svg`} alt="" width={size} height={size} loading="lazy" decoding="async" />
      </span>
      {withName ? <span className="min-w-0">{name}</span> : null}
      {caption ? <span className="whitespace-nowrap text-[10px] text-gray-500">{caption}</span> : null}
    </span>
  );
}
