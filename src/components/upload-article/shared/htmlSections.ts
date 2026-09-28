/**
 * ยูทิลจัดการ HTML ของบทความฝั่ง client (ไม่พึ่ง DOM/ไลบรารีนอก — ใช้ regex ล้วน)
 * ใช้เฉพาะแท็บ Review: หาให้ list ของ H2 ไว้เลือกตำแหน่งแทรกรูป และแทรก <figure> หลัง
 * ย่อหน้าแรกของหัวข้อ H2 ที่เลือก
 */

export interface H2Entry {
  /** ตำแหน่งเริ่มของแท็ก <h2> ใน html */
  index: number;
  text: string;
}

function stripTagsForLabel(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** คืนรายการ H2 ทั้งหมด (ตำแหน่ง + ข้อความ) ไว้ให้เลือกตำแหน่งแทรกรูป */
export function listH2Sections(html: string): H2Entry[] {
  const out: H2Entry[] = [];
  const re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push({ index: m.index, text: stripTagsForLabel(m[1]) || `หัวข้อที่ ${out.length + 1}` });
  }
  return out;
}

/**
 * แทรก figureHtml หลังย่อหน้าแรกของหัวข้อ H2 ที่ h2Index ระบุ (ตำแหน่งที่ได้จาก listH2Sections)
 * ถ้าไม่พบย่อหน้าในหัวข้อนั้น จะแทรกต่อจากปิดแท็ก </h2> แทน
 */
export function insertFigureAfterH2(html: string, h2Index: number, figureHtml: string): string {
  const h2Close = html.indexOf("</h2>", h2Index);
  if (h2Close < 0) return html;
  const afterH2 = h2Close + "</h2>".length;

  // หาหัวข้อ h2 ถัดไป เพื่อจำกัดขอบเขตของ section นี้
  const nextH2 = html.slice(afterH2).search(/<h2\b/i);
  const sectionEnd = nextH2 >= 0 ? afterH2 + nextH2 : html.length;
  const section = html.slice(afterH2, sectionEnd);

  const pMatch = /<p\b[^>]*>[\s\S]*?<\/p>/i.exec(section);
  if (pMatch) {
    const insertAt = afterH2 + pMatch.index + pMatch[0].length;
    return html.slice(0, insertAt) + "\n" + figureHtml + html.slice(insertAt);
  }
  return html.slice(0, afterH2) + "\n" + figureHtml + html.slice(afterH2);
}
