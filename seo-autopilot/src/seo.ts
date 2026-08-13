import type { Config } from "./config.js";
import { generateText, parseJson } from "./llm.js";

export type SeoTopic = {
  title: string;
  angle: string;
  targetKeyword: string;
  intent: "local" | "informational" | "transactional";
};

export type SeoArticle = {
  title: string;
  slug: string;
  metaDescription: string;
  targetKeyword: string;
  bodyHtml: string;
  readingMinutes: number;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function countWords(html: string): number {
  return html
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

export async function proposeTopics(
  config: Config,
  count = 5,
): Promise<SeoTopic[]> {
  const system = `Tu es un expert en SEO et en GEO (Generative Engine Optimization).
Site : ${config.siteName} — ${config.siteUrl}
Sujet : ${config.siteDescription}
Ton de voix : ${config.siteTone}

Génère du contenu utile, factuel, et structuré — optimisé pour être indexé par Google ET cité par des IA comme ChatGPT ou Perplexity.`;

  const prompt = `Propose ${count} sujets d'articles de blog pour ce site.

Méthode : inspire-toi de ce qui FONCTIONNE dans cette niche (requêtes récurrentes, questions Google, angles qui rankent). Mélange intention locale, informationnelle et transactionnelle.

Chaque article doit être utile, bien ciblé, et donner envie à quelqu'un de cliquer depuis Google.

Réponds UNIQUEMENT en JSON, un tableau de ${count} objets :
[{"title": "...", "angle": "1 phrase sur l'angle editorial", "targetKeyword": "le mot-clé principal visé", "intent": "local|informational|transactional"}]`;

  const raw = await generateText(config, { system, prompt, maxTokens: 1400 });
  const topics = parseJson<SeoTopic[]>(raw);
  return Array.isArray(topics) ? topics.slice(0, count) : [];
}

export async function generateArticle(
  config: Config,
  topic: SeoTopic,
): Promise<SeoArticle> {
  const system = `Tu es un rédacteur expert en SEO et GEO (Generative Engine Optimization).
Site : ${config.siteName} — ${config.siteUrl}
Sujet du site : ${config.siteDescription}
Ton de voix : ${config.siteTone}`;

  const prompt = `Rédige un article de blog complet.

Sujet : ${topic.title}
Angle : ${topic.angle}
Mot-clé visé : ${topic.targetKeyword}
Intention : ${topic.intent}

Exigences :
- Langue : français. Ton de voix du site. Zéro tournure générique d'IA.
- Longueur : 550 à 750 mots, utile et concret (pas de remplissage).
- SEO : mot-clé dans le titre, le 1er paragraphe et un <h2>. Variantes naturelles ailleurs.
- GEO : structure claire (chapô + 3 à 5 sections <h2>), phrases directes et factuelles — un ton qui peut être cité par une IA (ChatGPT, Perplexity, Google AI).
- Corps HTML sémantique propre uniquement : <p>, <h2>, <a href>, <strong>, <ul><li>. PAS de <html>, <head>, <style>, ni d'attributs style inline.

Réponds UNIQUEMENT en JSON :
{"title": "...", "slug": "tirets-minuscules", "metaDescription": "150-160 caractères", "targetKeyword": "${topic.targetKeyword}", "bodyHtml": "<p>...</p>...", "readingMinutes": 4}`;

  const raw = await generateText(config, { system, prompt, maxTokens: 3500 });
  const article = parseJson<SeoArticle>(raw);

  article.slug = slugify(article.slug || article.title);
  if (!article.readingMinutes) {
    article.readingMinutes = Math.max(2, Math.round(countWords(article.bodyHtml) / 200));
  }

  return article;
}
