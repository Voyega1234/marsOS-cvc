/**
 * WordGod v2 — /api/wordgod-v2/pipeline
 *
 * Unified keyword + title pipeline (ported from WordGod's chunked-continuation
 * architecture — see src/lib/wordgod/pipeline/wordgodPipeline.ts).
 * Streams SSE events while processing, then sends final result.
 *
 * POST body:
 *   seeds: string[]           — seed keywords
 *   niche: string             — content niche / business type
 *   businessContext: string   — business name + type (for AI title context)
 *   category: string
 *   targetLanguage?: string   — 'th' | 'en'
 *   targetCount: number       — how many keywords to produce
 *   excludeKeywords?: string[] — keywords to exclude
 *   useKeywordPlanner?: boolean
 *   forceRefresh?: boolean
 *   projectId?: string        — for AIJob cost logging + activity log
 *
 * SSE events:
 *   { type: 'log', msg: string }
 *   { type: 'done', result: PipelineResult }
 *   { type: 'checkpoint', state: PipelineCheckpoint } — chunked run suspended;
 *       re-POST the same body plus { chunked: true, checkpoint: state } to continue
 *   { type: 'error', msg: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { logAIJob, estimateGeminiCost, DFS_COST_PER_KEYWORD } from '@/lib/logAIJob';
import { runWordGodPipeline } from '@/lib/wordgod/pipeline/wordgodPipeline';
import { OR_MODELS } from '@/lib/openrouter';

export const maxDuration = 800; // Vercel Pro max — pipeline needs long runtime for large keyword runs

export async function POST(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session!.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const userId = session!.user.id;

  const body = await req.json();
  const {
    seeds, niche, businessContext, category, targetLanguage, targetCount,
    excludeKeywords, useKeywordPlanner, forceRefresh, intentRatio, presetKey,
    product_or_service, target_customer, customer_problems, pain_points,
    real_customer_questions, faq_from_sales_team, faq_from_customer_service,
    journey_stages, strategy_mode, ai_search_optimization, website_type,
    site_url, site_context_summary, site_categories,
    mode, planMonths, articlesPerMonth, planStartMonth, planPillars, metricMode,
    chunked, checkpoint, projectId,
  } = body;

  if (!seeds || !Array.isArray(seeds) || seeds.length === 0) {
    return NextResponse.json({ error: 'seeds array required' }, { status: 400 });
  }

  const startedAt = Date.now();
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const send = (data: object) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  (async () => {
    try {
      const result = await runWordGodPipeline({
        seeds,
        niche: niche || 'General',
        businessContext: businessContext || niche || 'General',
        category: category || niche || 'General',
        targetLanguage: targetLanguage || 'th',
        targetCount: Math.min(targetCount || 50, 3000),
        metricMode: metricMode === 'api_first' ? 'api_first' : 'api_only',
        intentRatio: intentRatio || undefined,
        presetKey: presetKey || undefined,
        excludeKeywords: excludeKeywords || [],
        useKeywordPlanner: useKeywordPlanner !== false,
        forceRefresh: !!forceRefresh,
        onProgress: (msg) => send({ type: 'log', msg }),
        signal: req.signal,
        product_or_service: product_or_service || undefined,
        target_customer: target_customer || undefined,
        customer_problems: customer_problems || [],
        pain_points: pain_points || [],
        real_customer_questions: real_customer_questions || [],
        faq_from_sales_team: faq_from_sales_team || [],
        faq_from_customer_service: faq_from_customer_service || [],
        journey_stages: journey_stages || undefined,
        strategy_mode: strategy_mode || 'hybrid',
        ai_search_optimization: ai_search_optimization !== false,
        website_type: website_type || undefined,
        site_url: site_url || undefined,
        site_context_summary: site_context_summary || undefined,
        site_categories: site_categories || undefined,
        mode: mode === 'full_plan' ? 'full_plan' : 'quick_research',
        planMonths: Math.min(Math.max(Number(planMonths) || 12, 1), 12),
        articlesPerMonth: Math.min(Math.max(Number(articlesPerMonth) || 12, 1), 50),
        planStartMonth: /^\d{4}-\d{2}$/.test(planStartMonth || '') ? planStartMonth : new Date().toISOString().slice(0, 7),
        planPillars: Array.isArray(planPillars) ? planPillars : undefined,
        // Chunked-run support: large runs suspend near the soft budget and
        // return a checkpoint; the client re-POSTs it to continue in a fresh
        // invocation. Non-chunked callers keep the original single-shot flow.
        chunked: chunked === true,
        checkpoint: checkpoint || undefined,
      });

      if ('__checkpoint' in result) {
        send({ type: 'checkpoint', state: result.__checkpoint });
      } else {
        send({ type: 'done', result });

        // AIJob cost logging — mirrors src/app/api/wordgod/keywords/route.ts
        const cost = result.meta.cost;
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        logAIJob({
          organizationId: orgId,
          projectId: projectId || null,
          jobType: 'KEYWORD_RESEARCH',
          modelProvider: 'OPENROUTER',
          modelName: OR_MODELS.default(),
          status: 'SUCCESS',
          tokenUsed: cost.total_tokens,
          estimatedCost: cost.gemini_cost_usd || estimateGeminiCost(cost.total_tokens),
          createdById: userId,
          inputSummary: `WordGod v2 KEYWORD_RESEARCH — ${result.keywords.length} keywords · ${elapsedSec}s`,
        }).catch(() => {});
        if (result.meta.planner_count > 0) {
          logAIJob({
            organizationId: orgId,
            projectId: projectId || null,
            jobType: 'KP_VOLUME_LOOKUP',
            modelProvider: 'GOOGLE',
            modelName: 'google_ads/keyword_planner',
            status: 'SUCCESS',
            externalCost: 0,
            externalCalls: result.meta.planner_count,
            externalApi: 'GoogleKeywordPlanner',
            createdById: userId,
            inputSummary: `WordGod v2 Google KP — ${result.meta.planner_count} lookups`,
          }).catch(() => {});
        }
        if (cost.dfs_keywords_called > 0) {
          logAIJob({
            organizationId: orgId,
            projectId: projectId || null,
            jobType: 'DFS_VOLUME_LOOKUP',
            modelProvider: 'DATAFORSEO',
            modelName: 'dataforseo/search_volume/live',
            status: 'SUCCESS',
            externalCost: cost.dfs_cost_usd || cost.dfs_keywords_called * DFS_COST_PER_KEYWORD,
            externalCalls: cost.dfs_keywords_called,
            externalApi: 'DataForSEO',
            createdById: userId,
            inputSummary: `WordGod v2 DFS — ${cost.dfs_keywords_called} lookups`,
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      send({ type: 'error', msg: err.message });
    } finally {
      writer.close();
    }
  })();

  return new NextResponse(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
