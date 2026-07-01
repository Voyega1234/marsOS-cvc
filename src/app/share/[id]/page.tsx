import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function SharePage({ params }: { params: { id: string } }) {
  const article = await prisma.article.findUnique({
    where: { id: params.id },
    include: { project: { select: { name: true } }, keyword: { select: { keyword: true } } },
  });

  if (!article || !["ARTICLE_DONE", "SEO_REVIEW", "APPROVED", "WORDPRESS_DRAFTED", "POSTED"].includes(article.status)) {
    notFound();
  }

  const html = article.htmlContent ?? "";

  return (
    <html lang="th">
      <head>
        <meta charSet="utf-8" />
        <title>{article.seoTitle ?? article.title}</title>
        <meta name="description" content={article.metaDescription ?? ""} />
        <meta name="robots" content="noindex,nofollow" />
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,400;0,600;0,700;1,400&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Sarabun', sans-serif; background: #f8fafc; color: #1e293b; }
          .wrapper { max-width: 760px; margin: 0 auto; padding: 48px 24px 80px; }
          .badge { display: inline-flex; align-items: center; gap: 6px; background: #f0fdf4; border: 1px solid #bbf7d0; color: #16a34a; font-size: 0.7rem; font-weight: 700; padding: 4px 10px; border-radius: 999px; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 0.05em; }
          h1 { font-size: 2rem; font-weight: 700; line-height: 1.25; margin-bottom: 16px; color: #0f172a; }
          .meta { display: flex; gap: 16px; font-size: 0.8rem; color: #64748b; margin-bottom: 36px; flex-wrap: wrap; }
          .meta span { display: flex; align-items: center; gap: 4px; }
          .content { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 40px 48px; line-height: 1.8; }
          .content h1 { font-size: 1.7rem; margin: 28px 0 12px; }
          .content h2 { font-size: 1.3rem; margin: 24px 0 10px; color: #1e3a5f; }
          .content h3 { font-size: 1.1rem; margin: 18px 0 8px; }
          .content p { margin-bottom: 14px; }
          .content ul, .content ol { padding-left: 22px; margin-bottom: 14px; }
          .content li { margin-bottom: 6px; }
          .content table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          .content th, .content td { border: 1px solid #e2e8f0; padding: 10px 14px; font-size: 0.875rem; }
          .content th { background: #f8fafc; font-weight: 700; }
          .footer { margin-top: 40px; text-align: center; font-size: 0.75rem; color: #94a3b8; }
          @media (max-width: 640px) { .content { padding: 24px 20px; } h1 { font-size: 1.5rem; } }
        `}</style>
      </head>
      <body>
        <div className="wrapper">
          <div className="badge">🔒 Client Preview — ไม่เผยแพร่สาธารณะ</div>
          <h1>{article.title}</h1>
          <div className="meta">
            <span>📁 {article.project.name}</span>
            {article.keyword && <span>🔑 {article.keyword.keyword}</span>}
            <span>📊 {article.funnelStage}</span>
          </div>
          <div className="content" dangerouslySetInnerHTML={{ __html: html || "<p><em>ยังไม่มีเนื้อหา</em></p>" }} />
          <div className="footer">Preview โดย Mars Pipeline · บทความนี้ยังไม่ได้เผยแพร่สาธารณะ</div>
        </div>
      </body>
    </html>
  );
}
