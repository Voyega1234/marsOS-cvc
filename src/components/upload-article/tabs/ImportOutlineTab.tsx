"use client";

/** แท็บ "Import Outline" — นำเข้า outline เป็นแถว keyword แล้วเขียนตามหัวข้อนั้น (Upload เท่านั้น) */
import { useState, type ComponentProps } from "react";
import ImportBox from "@/components/upload-article/shared/ImportBox";
import WriteTab from "@/components/upload-article/tabs/WriteTab";

const FORMAT_EXAMPLE = "H1: ชื่อบทความ\nH2: หัวข้อ\nH3: หัวข้อย่อย\n- แนวเนื้อหา";

export default function ImportOutlineTab({
  clientId, writeProps,
}: {
  clientId: string;
  /** props เดียวกับที่ WriteTab ได้รับในแท็บ Write Article */
  writeProps: Omit<ComponentProps<typeof WriteTab>, "outlineOnly" | "reloadKey">;
}) {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="space-y-4">
      <ImportBox
        clientId={clientId}
        endpoint="outlines"
        noun="outline"
        driveTarget="outline"
        pasteHeading="วาง outline"
        pastePlaceholder={FORMAT_EXAMPLE}
        onImported={async () => { setReloadKey(k => k + 1); }}
      >
        <p className="text-[11px] text-gray-500 leading-relaxed">
          outline ที่นำเข้าจะกลายเป็นแถว keyword ด้านล่าง · ตอนเขียน AI จะใช้หัวข้อตาม outline ตรงทุกคำและลำดับเดิม
          เพิ่มเนื้อหา/หัวข้อเสริมได้ แต่ไม่ตัด ไม่สลับ · ไม่ใช้ outline ใน Master Prompt
          <br />
          รูปแบบที่วางได้: H1: ชื่อบทความ / H2: หัวข้อ / H3: หัวข้อย่อย / - แนวเนื้อหา
        </p>
      </ImportBox>

      <WriteTab {...writeProps} outlineOnly reloadKey={reloadKey} />
    </div>
  );
}
