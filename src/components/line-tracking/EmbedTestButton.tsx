"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * "Test" button for the tracking snippet. The result is shown by the setup page from
 * ?embedTest=, so after the action returns we swap that param into the URL in place
 * (scroll: false) instead of letting the server redirect — a redirect reloads the page,
 * scrolls to the top and resets the wizard to its first step.
 */
export function EmbedTestButton({
  projectId,
  step,
  action,
}: {
  projectId: string;
  step: string;
  action: (formData: FormData) => Promise<{ verdict: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const { verdict } = await action(fd);
          const params = new URLSearchParams({ step, embedTest: verdict });
          router.replace(`?${params.toString()}`, { scroll: false });
        })
      }
    >
      <input type="hidden" name="projectId" value={projectId} />
      <button type="submit" disabled={pending} className={`btn-secondary text-sm ${pending ? "opacity-50" : ""}`}>
        {pending ? "กำลังตรวจ…" : "🔍 Test — เช็คว่าโค้ดอยู่บนเว็บแล้วหรือยัง"}
      </button>
    </form>
  );
}
