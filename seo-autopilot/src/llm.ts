import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";

export async function generateText(
  config: Config,
  opts: {
    system: string;
    prompt: string;
    maxTokens?: number;
  },
): Promise<string> {
  const { system, prompt, maxTokens = 3500 } = opts;

  if (config.llmProvider === "anthropic") {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const message = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    if (block.type !== "text") throw new Error("Réponse LLM inattendue");
    return block.text;
  }

  // DeepSeek (API compatible OpenAI)
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`DeepSeek ${res.status}: ${t.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Extrait un bloc JSON d'une réponse LLM, même entourée de texte / ```fences. */
export function parseJson<T>(raw: string): T {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/[[\{]/);
  const end = Math.max(s.lastIndexOf("]"), s.lastIndexOf("}"));
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s) as T;
}
