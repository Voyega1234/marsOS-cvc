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
 *   targetLanguage?: string   — 'th' | 'en' (ignored when language_mode is set)
 *   language_mode?: string    — 'th' | 'en' | 'both' — overrides targetLanguage.
 *       'both' runs the pipeline once per language and mixes the two keyword
 *       sets by ratio_thai (count split); only supported for projects whose
 *       Project.language is 'en' (see LanguageModeSelect.tsx).
 *   ratio_thai?: number       — 0-100, % of targetCount in Thai when 'both' (default 50)
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
 *       (chunked resume is NOT supported for language_mode 'both' — each call
 *       runs both languages single-shot)
 *   { type: 'error', msg: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { logAIJob, estimateGeminiCost, DFS_COST_PER_KEYWORD } from '@/lib/logAIJob';
import { runWordGodPipeline, type PipelineInput, type PipelineResult } from '@/lib/wordgod/pipeline/wordgodPipeline';
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
    language_mode, ratio_thai,
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

  // language_mode ('th' | 'en' | 'both') takes priority over the legacy
  // targetLanguage field — kept for backward compatibility with old callers.
  const languageMode: 'th' | 'en' | 'both' =
    language_mode === 'en' || language_mode === 'both' ? language_mode
    : language_mode === 'th' ? 'th'
    : (targetLanguage === 'en' ? 'en' : 'th');
  const ratioThai = Math.min(Math.max(Number(ratio_thai) || 50, 0), 100);
  const requestedCount = Math.min(targetCount || 50, 3000);

  const buildOptions = (lang: 'th' | 'en', count: number): PipelineInput => ({
    seeds,
    niche: niche || 'General',
    businessContext: businessContext || niche || 'General',
    category: category || niche || 'General',
    targetLanguage: lang,
    targetCount: count,
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
    // 'both' mode always runs single-shot (see note above) — chunked/checkpoint
    // are only forwarded for single-language runs.
    chunked: languageMode === 'both' ? false : chunked === true,
    checkpoint: languageMode === 'both' ? undefined : (checkpoint || undefined),
  });

  // Merge two PipelineResult objects (Thai + English) into one for 'both' mode —
  // keywords/clusters/warnings concat, cost + counters sum.
  function mergeResults(a: PipelineResult, b: PipelineResult): PipelineResult {
    return {
      keywords: [...a.keywords, ...b.keywords],
      clusters: {
        clusters: [...a.clusters.clusters, ...b.clusters.clusters],
        ungrouped: [...a.clusters.ungrouped, ...b.clusters.ungrouped],
      },
      plan: a.plan || b.plan,
      meta: {
        ...a.meta,
        total: a.meta.total + b.meta.total,
        requested_count: a.meta.requested_count + b.meta.requested_count,
        candidate_count: a.meta.candidate_count + b.meta.candidate_count,
        api_backed_count: a.meta.api_backed_count + b.meta.api_backed_count,
        derived_count: a.meta.derived_count + b.meta.derived_count,
        estimated_count: a.meta.estimated_count + b.meta.estimated_count,
        shortfall_count: a.meta.shortfall_count + b.meta.shortfall_count,
        planner_count: a.meta.planner_count + b.meta.planner_count,
        dataforseo_count: a.meta.dataforseo_count + b.meta.dataforseo_count,
        gemini_count: a.meta.gemini_count + b.meta.gemini_count,
        title_ai_count: a.meta.title_ai_count + b.meta.title_ai_count,
        fallback_title_count: a.meta.fallback_title_count + b.meta.fallback_title_count,
        cluster_count: a.meta.cluster_count + b.meta.cluster_count,
        warnings: [...a.meta.warnings, ...b.meta.warnings],
        grounding_queries: [...(a.meta.grounding_queries || []), ...(b.meta.grounding_queries || [])],
        grounding_urls: [...(a.meta.grounding_urls || []), ...(b.meta.grounding_urls || [])],
        cost: {
          input_tokens: a.meta.cost.input_tokens + b.meta.cost.input_tokens,
          output_tokens: a.meta.cost.output_tokens + b.meta.cost.output_tokens,
          total_tokens: a.meta.cost.total_tokens + b.meta.cost.total_tokens,
          gemini_cost_usd: a.meta.cost.gemini_cost_usd + b.meta.cost.gemini_cost_usd,
          gemini_cost_thb: a.meta.cost.gemini_cost_thb + b.meta.cost.gemini_cost_thb,
          dfs_keywords_called: a.meta.cost.dfs_keywords_called + b.meta.cost.dfs_keywords_called,
          dfs_kd_keywords_called: (a.meta.cost.dfs_kd_keywords_called || 0) + (b.meta.cost.dfs_kd_keywords_called || 0),
          dfs_cost_usd: a.meta.cost.dfs_cost_usd + b.meta.cost.dfs_cost_usd,
          dfs_cost_thb: a.meta.cost.dfs_cost_thb + b.meta.cost.dfs_cost_thb,
          dfs_kd_cost_usd: (a.meta.cost.dfs_kd_cost_usd || 0) + (b.meta.cost.dfs_kd_cost_usd || 0),
          dfs_kd_cost_thb: (a.meta.cost.dfs_kd_cost_thb || 0) + (b.meta.cost.dfs_kd_cost_thb || 0),
          kp_keywords_fetched: a.meta.cost.kp_keywords_fetched + b.meta.cost.kp_keywords_fetched,
          kp_cost_usd: a.meta.cost.kp_cost_usd + b.meta.cost.kp_cost_usd,
          kp_cost_thb: a.meta.cost.kp_cost_thb + b.meta.cost.kp_cost_thb,
          cost_usd: a.meta.cost.cost_usd + b.meta.cost.cost_usd,
          cost_thb: a.meta.cost.cost_thb + b.meta.cost.cost_thb,
          total_cost_usd: a.meta.cost.total_cost_usd + b.meta.cost.total_cost_usd,
          total_cost_thb: a.meta.cost.total_cost_thb + b.meta.cost.total_cost_thb,
        },
      },
    };
  }

  (async () => {
    try {
      let result: PipelineResult;

      if (languageMode === 'both') {
        const thCount = Math.round(requestedCount * (ratioThai / 100));
        const enCount = requestedCount - thCount;
        send({ type: 'log', msg: `🌐 โหมดไทย+อังกฤษ — ไทย ${thCount} / อังกฤษ ${enCount} คำ` });

        const thOutcome = thCount > 0 ? await runWordGodPipeline(buildOptions('th', thCount)) : null;
        if (thOutcome && '__checkpoint' in thOutcome) {
          send({ type: 'checkpoint', state: thOutcome.__checkpoint });
          return;
        }
        const enOutcome = enCount > 0 ? await runWordGodPipeline(buildOptions('en', enCount)) : null;
        if (enOutcome && '__checkpoint' in enOutcome) {
          send({ type: 'checkpoint', state: enOutcome.__checkpoint });
          return;
        }

        if (thOutcome && enOutcome) result = mergeResults(thOutcome, enOutcome);
        else result = (thOutcome || enOutcome) as PipelineResult;
      } else {
        const outcome = await runWordGodPipeline(buildOptions(languageMode, requestedCount));
        if ('__checkpoint' in outcome) {
          send({ type: 'checkpoint', state: outcome.__checkpoint });
          return;
        }
        result = outcome;
      }

      {
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
