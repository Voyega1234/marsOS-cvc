"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { EntityAvatar } from "@/components/ds";
import { PROJECT_LOGO_ERROR_TEXT, type ProjectLogoError } from "@/lib/line-tracking/projectLogo";

/** Longest side of the stored logo, in pixels. Shown at 44 px; 256 stays sharp on retina. */
const LOGO_SIZE = 256;

/**
 * Shrinks the picked image to fit a LOGO_SIZE square (aspect kept, transparent padding)
 * and returns a WebP data URI, or PNG where the browser cannot encode WebP.
 */
async function shrinkToDataUri(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("unreadable"));
      el.src = url;
    });
    const scale = Math.min(1, LOGO_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const side = Math.max(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(img, Math.round((side - w) / 2), Math.round((side - h) / 2), w, h);
    const webp = canvas.toDataURL("image/webp", 0.9);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ProjectLogoField({
  projectId,
  projectName,
  logo,
  action,
}: {
  projectId: string;
  projectName: string;
  logo: string | null;
  action: (formData: FormData) => Promise<{ ok: true } | { ok: false; code: ProjectLogoError }>;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  function send(fd: FormData, okText: string) {
    fd.set("projectId", projectId);
    startTransition(async () => {
      try {
        const result = await action(fd);
        if (result.ok) {
          setMessage({ tone: "ok", text: okText });
          router.refresh();
        } else {
          setMessage({ tone: "bad", text: PROJECT_LOGO_ERROR_TEXT[result.code] });
        }
      } catch {
        setMessage({ tone: "bad", text: "บันทึกโลโก้ไม่สำเร็จ ลองใหม่อีกครั้ง" });
      }
    });
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif|bmp|avif)$/.test(file.type)) {
      setMessage({ tone: "bad", text: PROJECT_LOGO_ERROR_TEXT.invalid });
      return;
    }
    let dataUri: string;
    try {
      dataUri = await shrinkToDataUri(file);
    } catch {
      setMessage({ tone: "bad", text: PROJECT_LOGO_ERROR_TEXT.invalid });
      return;
    }
    const fd = new FormData();
    fd.set("logo", dataUri);
    send(fd, "บันทึกโลโก้แล้ว");
  }

  return (
    <div id="project-logo" className="card p-5 space-y-3">
      <div className="text-sm font-medium text-gray-600">โลโก้โปรเจกต์</div>
      <div className="flex flex-wrap items-center gap-3">
        <EntityAvatar label={projectName} src={logo ?? undefined} size={56} />
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className="hidden"
          onChange={(e) => {
            void onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn-primary" disabled={pending} onClick={() => inputRef.current?.click()}>
          {pending ? "กำลังบันทึก…" : logo ? "เปลี่ยนโลโก้" : "อัปโหลดโลโก้"}
        </button>
        {logo && (
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() => {
              const fd = new FormData();
              fd.set("remove", "1");
              send(fd, "ลบโลโก้แล้ว");
            }}
          >
            ลบโลโก้
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">แสดงแทนตัวอักษรย่อในหน้า Projects · ระบบย่อรูปให้เป็นสี่เหลี่ยมจัตุรัส {LOGO_SIZE}px เอง</p>
      {message && (
        <p
          className={`rounded-lg p-2 text-xs ${
            message.tone === "ok" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
