/** URL สาธารณะสำหรับ webhook — ใช้เฉพาะ production และไม่อ่านจาก origin ของ request */
export function webhookBaseUrl(): string | null {
  if (process.env.VERCEL_ENV !== "production") return null;
  const pub = (process.env.MARS_PUBLIC_URL ?? "").trim();
  let base: string | null = null;
  if (pub.startsWith("https://")) base = pub;
  else {
    const prod = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
    if (prod) base = `https://${prod}`;
  }
  return base ? base.replace(/\/+$/, "") : null;
}
