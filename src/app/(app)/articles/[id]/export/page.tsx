import { notFound } from "next/navigation";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ArticleExportPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;

  const article = await prisma.article.findUnique({
    where: { id: params.id },
    include: { project: true, keyword: true, assignedTo: true },
  });

  if (!article || article.project.organizationId !== orgId) notFound();

  const html = article.htmlContent ?? "";

  return (
    <html lang="th">
      <head>
        <meta charSet="utf-8" />
        <title>{article.seoTitle ?? article.title}</title>
        <meta name="description" content={article.metaDescription ?? ""} />
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Sarabun', sans-serif; background: #fff; color: #1e293b; line-height: 1.7; }
          .brief { max-width: 820px; margin: 0 auto; padding: 48px 32px; }
          .meta-bar { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 24px; margin-bottom: 32px; }
          .meta-bar h1 { font-size: 1.4rem; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
          .meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 12px; }
          .meta-item label { display: block; font-size: 0.7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
          .meta-item span { font-size: 0.85rem; color: #334155; font-weight: 600; }
          .seo-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px 20px; margin-bottom: 28px; }
          .seo-box h3 { font-size: 0.75rem; font-weight: 700; color: #16a34a; text-transform: uppercase; margin-bottom: 6px; }
          .seo-box p { font-size: 0.85rem; color: #166534; }
          .divider { border: none; border-top: 1px solid #e2e8f0; margin: 28px 0; }
          .content h1 { font-size: 1.8rem; font-weight: 700; margin: 24px 0 12px; }
          .content h2 { font-size: 1.3rem; font-weight: 700; margin: 20px 0 10px; color: #1e3a5f; }
          .content h3 { font-size: 1.1rem; font-weight: 600; margin: 16px 0 8px; }
          .content p  { margin-bottom: 12px; }
          .content ul, .content ol { padding-left: 20px; margin-bottom: 12px; }
          .content li { margin-bottom: 4px; }
          .content table { width: 100%; border-collapse: collapse; margin: 16px 0; }
          .content th, .content td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; font-size: 0.875rem; }
          .content th { background: #f8fafc; font-weight: 700; }
          .watermark { text-align: center; margin-top: 48px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 0.75rem; color: #94a3b8; }
          @media print {
            .no-print { display: none !important; }
            body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          }
        `}</style>
      </head>
      <body>
        <div className="brief">
          {/* Print / Download toolbar */}
          <div className="no-print" style={{ marginBottom: "20px", display: "flex", gap: "10px" }}>
            <button
              onClick={() => window.print()}
              style={{ padding: "8px 18px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 700, cursor: "pointer", fontSize: "0.875rem" }}
            >
              🖨️ Print / Save PDF
            </button>
            <a
              href={`/articles/${article.id}`}
              style={{ padding: "8px 18px", background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0", borderRadius: "8px", fontWeight: 600, cursor: "pointer", fontSize: "0.875rem", textDecoration: "none" }}
            >
              ← กลับ Editor
            </a>
          </div>

          {/* Meta */}
          <div className="meta-bar">
            <h1>{article.title}</h1>
            <div className="meta-grid">
              <div className="meta-item"><label>Project</label><span>{article.project.name}</span></div>
              <div className="meta-item"><label>Keyword</label><span>{article.keyword?.keyword ?? "—"}</span></div>
              <div className="meta-item"><label>Funnel</label><span>{article.funnelStage}</span></div>
              <div className="meta-item"><label>Status</label><span>{article.status}</span></div>
              {article.assignedTo && <div className="meta-item"><label>Writer</label><span>{article.assignedTo.name}</span></div>}
              {article.scheduledAt && <div className="meta-item"><label>Scheduled</label><span>{new Date(article.scheduledAt).toLocaleDateString("th-TH")}</span></div>}
            </div>
          </div>

          {/* SEO Meta */}
          {(article.seoTitle || article.metaDescription) && (
            <div className="seo-box">
              <h3>SEO Meta</h3>
              {article.seoTitle && <p><strong>Title:</strong> {article.seoTitle}</p>}
              {article.metaDescription && <p style={{ marginTop: "4px" }}><strong>Description:</strong> {article.metaDescription}</p>}
            </div>
          )}

          <hr className="divider" />

          {/* Article Content */}
          <div className="content" dangerouslySetInnerHTML={{ __html: html || "<p><em>ยังไม่มีเนื้อหา</em></p>" }} />

          <div className="watermark">Generated by Mars Pipeline · {new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })}</div>
        </div>
      </body>
    </html>
  );
}
