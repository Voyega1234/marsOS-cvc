"use client";

/** เลือกโปรเจกต์ Asana ปลายทางของงาน — โหลดรายการตอนเปิดครั้งแรก (แคชทั้งหน้า) + วางลิงก์โปรเจกต์ที่หาไม่เจอเพื่อบันทึกถาวร */
import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "./shared";
import SearchSelect from "./SearchSelect";

interface AsanaProjectItem { gid: string; name: string; workspaceName: string; teamName?: string; saved?: boolean }
interface AsanaProjectsResp { projects: AsanaProjectItem[]; truncated: boolean }

// แคช promise ระดับโมดูล — เปิดหลายช่องพร้อมกันยิงครั้งเดียว; ล้มเหลวแล้วล้างทิ้งให้ลองใหม่ได้
let cached: Promise<AsanaProjectsResp> | null = null;
function loadAsanaProjects(): Promise<AsanaProjectsResp> {
  if (!cached) {
    cached = api<AsanaProjectsResp>("/api/backlink-management/asana/projects").catch((e) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}

export default function AsanaProjectSelect({ value, onChange, defaultProjectName, disabled, className }: {
  value: string;
  onChange: (gid: string) => void;
  defaultProjectName?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [data, setData] = useState<AsanaProjectsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [extra, setExtra] = useState<AsanaProjectItem[]>([]);
  const [showLink, setShowLink] = useState(false);
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [linkError, setLinkError] = useState("");

  const onOpen = useCallback(() => {
    if (data || loading) return;
    setLoading(true);
    setError("");
    loadAsanaProjects()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดรายการโปรเจกต์ Asana ไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [data, loading]);

  const saveLink = useCallback(async () => {
    const text = link.trim();
    if (!text) { setLinkError("วางลิงก์โปรเจกต์ก่อน"); return; }
    if (saving) return;
    setSaving(true);
    setLinkError("");
    try {
      const { project } = await api<{ project: AsanaProjectItem }>("/api/backlink-management/asana/projects", { method: "POST", json: { link: text } });
      cached = null;
      setExtra((prev) => [project, ...prev.filter((p) => p.gid !== project.gid)]);
      setData((d) => d && { ...d, projects: [project, ...d.projects.filter((p) => p.gid !== project.gid)] });
      onChange(project.gid);
      toast.success(`บันทึกโปรเจกต์ "${project.name}" แล้ว — ครั้งหน้าจะอยู่ในรายการ`);
      setLink("");
      setShowLink(false);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "บันทึกโปรเจกต์ไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }, [link, saving, onChange]);

  const all = [...extra, ...(data?.projects ?? []).filter((p) => !extra.some((x) => x.gid === p.gid))];
  const options = all.map((p) => {
    const base = p.teamName || p.workspaceName;
    return {
      value: p.gid,
      label: p.name,
      hint: p.saved ? (base ? `${base} · บันทึกไว้` : "บันทึกไว้") : base,
      keywords: `${p.teamName ?? ""} ${p.workspaceName}`,
    };
  });

  return (
    <div>
      <SearchSelect
        value={value}
        onChange={onChange}
        options={options}
        emptyLabel={defaultProjectName ? `ค่าเริ่มต้น: ${defaultProjectName}` : "ค่าเริ่มต้นของระบบ"}
        disabled={disabled}
        className={className}
        ariaLabel="โปรเจกต์ Asana"
        loading={loading}
        error={error || (data?.truncated ? "รายการยังไม่ครบ — ถ้าค้นหาไม่เจอ ให้วางลิงก์โปรเจกต์ด้านล่าง" : "")}
        onOpen={onOpen}
      />
      {!disabled && (
        <div className="mt-1">
          <button type="button" className="text-xs text-gray-600 underline" onClick={() => setShowLink((v) => !v)}>
            หาโปรเจกต์ไม่เจอ? วางลิงก์โปรเจกต์จาก Asana
          </button>
          {showLink && (
            <div className="mt-1 space-y-1">
              <div className="flex gap-2">
                <Input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveLink(); } }}
                  placeholder="วางลิงก์โปรเจกต์จาก Asana เช่น https://app.asana.com/…"
                  aria-label="ลิงก์โปรเจกต์ Asana"
                  disabled={saving}
                />
                <Button type="button" size="sm" onClick={() => void saveLink()} disabled={saving}>
                  {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  บันทึกโปรเจกต์
                </Button>
              </div>
              {linkError && <p className="text-xs text-red-600">{linkError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
