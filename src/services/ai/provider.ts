import Anthropic from "@anthropic-ai/sdk";

export interface AIProviderOptions {
  provider: "CLAUDE" | "OPENAI" | "GEMINI" | "CUSTOM";
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIProviderResult {
  content: string;
  tokensUsed: number;
  estimatedCost: number;
}

const COST_PER_TOKEN: Record<string, number> = {
  CLAUDE: 0.000003,
  OPENAI: 0.000002,
  GEMINI: 0.0000015,
  CUSTOM: 0.000001,
};

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export async function callAIProvider(opts: AIProviderOptions): Promise<AIProviderResult> {
  const { provider, model, prompt, temperature = 0.7, maxTokens = 4000 } = opts;

  // ── Claude (Anthropic) ────────────────────────────────────────────────────
  if (provider === "CLAUDE") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: "user", content: prompt }],
      });
      const content = msg.content[0].type === "text" ? msg.content[0].text : "";
      const tokensUsed = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
      return {
        content,
        tokensUsed,
        estimatedCost: tokensUsed * COST_PER_TOKEN.CLAUDE,
      };
    }
  }

  // ── Fallback: mock (no API key configured) ────────────────────────────────
  await delay(800 + Math.random() * 800);
  const tokensUsed = Math.floor(prompt.length / 4) + Math.floor(Math.random() * 500);
  return {
    content: "__MOCK__",
    tokensUsed,
    estimatedCost: tokensUsed * (COST_PER_TOKEN[provider] ?? 0.000003),
  };
}
