/**
 * มุมมอง "Text" ของแท็บ Generate — เหลือแค่เนื้อหาบทความ + รูป เหมือนต้นฉบับ
 * (ไม่มี schema / CSS / breadcrumb / สารบัญ, FAQ กลับเป็นหัวข้อ + คำตอบธรรมดา)
 */

/** ถอด HTML ที่ generate แล้วให้เหลือเนื้อหาล้วน */
export function toReadableHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.querySelectorAll("script, style, nav.content-breadcrumb, nav.content-toc").forEach(el => el.remove());
  doc.querySelectorAll("details").forEach(det => {
    const q = det.querySelector("summary");
    const a = det.querySelector(".content-faq__answer");
    const frag = doc.createDocumentFragment();
    if (q) {
      const h = doc.createElement("h3");
      h.innerHTML = q.innerHTML;
      frag.appendChild(h);
    }
    if (a) while (a.firstChild) frag.appendChild(a.firstChild);
    det.replaceWith(frag);
  });
  doc.querySelectorAll("div.content-article, div.content-table-wrap, span.content-faq__q").forEach(el => {
    el.replaceWith(...Array.from(el.childNodes));
  });
  doc.body.querySelectorAll("[class]").forEach(el => el.removeAttribute("class"));
  const style = "<style>body{font-family:sans-serif;line-height:1.7;color:#111;padding:4px 8px}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}</style>";
  return style + doc.body.innerHTML.trim();
}

/** ย่อ base64 ของรูปให้อ่านโค้ดได้ (ใช้แสดงผลเท่านั้น — ตอนคัดลอกใช้ของเต็ม) */
export function shortenDataUris(html: string): string {
  return html.replace(/(data:image\/[a-z0-9.+-]+;base64,)([A-Za-z0-9+/=]{200,})/gi, (_m, head: string, data: string) => {
    const kb = Math.round((data.length * 3) / 4 / 1024);
    return `${head}…[รูป ${kb} KB]`;
  });
}

/** คัดลอกเป็น rich text (วางใน WordPress/Google Docs ได้หัวข้อ + รูปครบ) พร้อม plain text สำรอง */
export async function copyRichText(html: string): Promise<void> {
  const body = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  const plain = typeof DOMParser === "undefined"
    ? body.replace(/<[^>]+>/g, " ")
    : (new DOMParser().parseFromString(`<body>${body}</body>`, "text/html").body.innerText || "");
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([body], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    })]);
    return;
  }
  await navigator.clipboard.writeText(plain);
}
