"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Connect / rotate button for the Looker card.
 *
 * The fresh token has to end up in the URL (it is the only place the plaintext exists),
 * but a server-side redirect() reloads the page and scrolls to the top. So the action
 * returns the token and this component swaps the URL in place with scroll: false — the
 * card re-renders with the one-click links exactly where the user is looking.
 */
export function LookerConnectButton({
  projectId,
  connected,
  action,
}: {
  projectId: string;
  connected: boolean;
  action: (formData: FormData) => Promise<{ token: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const { token } = await action(fd);
          const params = new URLSearchParams({ step: "looker", lookerToken: token });
          router.replace(`?${params.toString()}`, { scroll: false });
        })
      }
    >
      <input type="hidden" name="projectId" value={projectId} />
      <button
        type="submit"
        disabled={pending}
        className={`${connected ? "btn-secondary" : "btn-primary"} text-sm ${pending ? "opacity-50" : ""}`}
      >
        {pending ? "กำลังสร้าง token…" : connected ? "สร้าง token ใหม่ (rotate)" : "เชื่อมต่อ Looker"}
      </button>
    </form>
  );
}
