// Where the public /line/start page may send a visitor.
//
// The page takes a `next` address from the URL. Following any address would turn our own
// domain into an open redirect (a link that looks like ours but lands on a stranger's site),
// so only LINE's own hosts are accepted.
const LINE_HOSTS = ["lin.ee", "line.me"];

export function safeLineDestination(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const allowed = LINE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  return allowed ? url.toString() : null;
}
