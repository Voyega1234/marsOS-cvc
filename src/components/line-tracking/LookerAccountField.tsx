"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export const LOOKER_ACCOUNT_COOKIE = "lookerAccount";

/**
 * "Open Looker as <Google account>" — the email every Looker link carries as `authuser`.
 *
 * Defaults to the MarsOS login, but that is often a different Google account from the
 * one that has access to the connector script (personal Gmail vs. company Workspace).
 * The choice is kept in a cookie so the server can bake it into the links, and the
 * page is refreshed in place (no scroll jump) when it changes.
 */
export function LookerAccountField({ current }: { current: string }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [pending, startTransition] = useTransition();
  const dirty = value.trim() !== current;

  function save() {
    const email = value.trim();
    document.cookie = `${LOOKER_ACCOUNT_COOKIE}=${encodeURIComponent(email)}; path=/; max-age=31536000; SameSite=Lax`;
    startTransition(() => router.refresh());
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="font-medium text-slate-700" htmlFor="looker-account">
        เปิด Looker ด้วยบัญชี Google:
      </label>
      <input
        id="looker-account"
        type="email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="name@convertcake.com"
        className="field-input w-72 text-sm"
      />
      <button type="submit" disabled={!dirty || pending} className={`btn-secondary text-sm ${!dirty || pending ? "opacity-50" : ""}`}>
        {pending ? "กำลังบันทึก…" : "ใช้บัญชีนี้"}
      </button>
    </form>
  );
}
