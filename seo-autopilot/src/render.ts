import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Config } from "./config.js";
import type { SeoArticle } from "./seo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function frDate(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/** Charge le template article (template.html à la racine du projet). */
function loadTemplate(): string {
  const templatePath = join(__dirname, "..", "template.html");
  if (!existsSync(templatePath)) {
    // Template minimaliste par défaut
    return defaultTemplate();
  }
  return readFileSync(templatePath, "utf-8");
}

/** Construit la page HTML complète de l'article. */
export function renderArticlePage(
  config: Config,
  article: SeoArticle,
): { html: string; dateIso: string; dateFr: string } {
  const now = new Date();
  const dateIso = now.toISOString().slice(0, 10);
  const dateFr = frDate(now);
  const articleUrl = `${config.siteUrl}/${config.blogDir}/${article.slug}.html`;

  const template = loadTemplate();
  const html = template
    .replace(/\{\{SITE_NAME\}\}/g, esc(config.siteName))
    .replace(/\{\{SITE_URL\}\}/g, config.siteUrl)
    .replace(/\{\{TITLE\}\}/g, esc(article.title))
    .replace(/\{\{TITLE_RAW\}\}/g, article.title)
    .replace(/\{\{META_DESCRIPTION\}\}/g, esc(article.metaDescription))
    .replace(/\{\{TARGET_KEYWORD\}\}/g, esc(article.targetKeyword))
    .replace(/\{\{DATE_ISO\}\}/g, dateIso)
    .replace(/\{\{DATE_FR\}\}/g, dateFr)
    .replace(/\{\{READING_MINUTES\}\}/g, String(article.readingMinutes))
    .replace(/\{\{SLUG\}\}/g, article.slug)
    .replace(/\{\{ARTICLE_URL\}\}/g, articleUrl)
    .replace(/\{\{BLOG_DIR\}\}/g, config.blogDir)
    .replace(/\{\{CONTENT\}\}/g, article.bodyHtml);

  return { html, dateIso, dateFr };
}

/** Injecte une carte article dans l'index du blog après l'ancre configurée. */
export function injectIntoIndex(
  indexHtml: string,
  config: Config,
  article: SeoArticle,
  dateIso: string,
  dateFr: string,
): string {
  const card = `
    <article class="post-card">
      <a href="${article.slug}.html">
        <span class="post-card__tag">Article</span>
        <h2 class="post-card__title">${esc(article.title)}</h2>
        <p class="post-card__excerpt">${esc(article.metaDescription)}</p>
        <span class="post-card__meta">${article.readingMinutes} min de lecture · <time datetime="${dateIso}">${dateFr}</time></span>
      </a>
    </article>
`;

  const anchor = config.blogIndexAnchor;
  if (!indexHtml.includes(anchor)) {
    console.warn(
      `[render] Ancre "${anchor}" introuvable dans l'index — la carte n'a pas été injectée.`,
    );
    return indexHtml;
  }
  return indexHtml.replace(anchor, anchor + card);
}

/** Ajoute une entrée dans sitemap.xml. */
export function addSitemapEntry(sitemap: string, url: string): string {
  const entry = `  <url>\n    <loc>${url}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
  return sitemap.replace("</urlset>", entry + "</urlset>");
}

/** Template HTML par défaut si template.html est absent. */
function defaultTemplate(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{TITLE}} | {{SITE_NAME}}</title>
  <meta name="description" content="{{META_DESCRIPTION}}" />
  <meta name="keywords" content="{{TARGET_KEYWORD}}" />
  <link rel="canonical" href="{{ARTICLE_URL}}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="{{TITLE}}" />
  <meta property="og:description" content="{{META_DESCRIPTION}}" />
  <meta property="og:url" content="{{ARTICLE_URL}}" />
  <meta property="article:published_time" content="{{DATE_ISO}}" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "{{TITLE_RAW}}",
    "description": "{{META_DESCRIPTION}}",
    "datePublished": "{{DATE_ISO}}",
    "dateModified": "{{DATE_ISO}}",
    "author": { "@type": "Organization", "name": "{{SITE_NAME}}", "url": "{{SITE_URL}}" },
    "publisher": { "@type": "Organization", "name": "{{SITE_NAME}}" },
    "mainEntityOfPage": "{{ARTICLE_URL}}"
  }
  </script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;line-height:1.7;background:#fff}
    .wrap{max-width:760px;margin:0 auto;padding:2rem 1.5rem}
    header{border-bottom:1px solid #e5e5e5;margin-bottom:3rem}
    header a{color:inherit;text-decoration:none;font-weight:600;font-size:1.1rem;display:inline-block;padding:1.2rem 0}
    h1{font-size:2rem;line-height:1.25;margin-bottom:.75rem;font-weight:700}
    .meta{color:#666;font-size:.9rem;margin-bottom:2rem}
    .lede{font-size:1.15rem;color:#444;margin-bottom:2rem;line-height:1.6}
    article h2{font-size:1.3rem;margin:2rem 0 .6rem;font-weight:600}
    article p{margin-bottom:1.1rem}
    article ul{margin:.5rem 0 1.1rem 1.5rem}
    article li{margin-bottom:.35rem}
    article a{color:#0057b7;text-decoration:underline}
    article strong{font-weight:600}
    footer{border-top:1px solid #e5e5e5;padding:1.5rem 0;text-align:center;color:#888;font-size:.875rem;margin-top:4rem}
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <a href="{{SITE_URL}}">← {{SITE_NAME}}</a>
    </div>
  </header>
  <main class="wrap">
    <h1>{{TITLE}}</h1>
    <p class="meta">Publié le {{DATE_FR}} · {{READING_MINUTES}} min de lecture</p>
    <p class="lede">{{META_DESCRIPTION}}</p>
    <article>
{{CONTENT}}
    </article>
  </main>
  <footer>
    <div class="wrap">© {{SITE_NAME}} · <a href="{{SITE_URL}}/{{BLOG_DIR}}/">Tous les articles</a></div>
  </footer>
</body>
</html>`;
}
