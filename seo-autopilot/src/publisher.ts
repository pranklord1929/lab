import type { Config } from "./config.js";
import type { SeoArticle } from "./seo.js";
import { readFile, commitFile } from "./github.js";
import { renderArticlePage, injectIntoIndex, addSitemapEntry } from "./render.js";

export type PublishResult =
  | { ok: true; url: string; commitSha: string }
  | { ok: false; error: string };

export async function publishArticle(
  config: Config,
  article: SeoArticle,
): Promise<PublishResult> {
  try {
    const { html, dateIso, dateFr } = renderArticlePage(config, article);
    const articlePath = `${config.blogDir}/${article.slug}.html`;
    const articleUrl = `${config.siteUrl}/${config.blogDir}/${article.slug}.html`;

    // 1. Commit de la page article
    const commitSha = await commitFile(config, {
      path: articlePath,
      content: html,
      message: `SEO: ${article.title}`,
    });

    // 2. Mise à jour de l'index du blog
    const indexHtml = await readFile(config, config.blogIndexPath);
    if (indexHtml) {
      const newIndex = injectIntoIndex(indexHtml, config, article, dateIso, dateFr);
      await commitFile(config, {
        path: config.blogIndexPath,
        content: newIndex,
        message: `SEO: ajoute "${article.title}" à l'index`,
      });
    } else {
      console.warn(
        `[publisher] Index ${config.blogIndexPath} introuvable sur le repo — non mis à jour.`,
      );
    }

    // 3. Mise à jour du sitemap (optionnel)
    if (config.sitemapPath) {
      const sitemap = await readFile(config, config.sitemapPath);
      if (sitemap) {
        const newSitemap = addSitemapEntry(sitemap, articleUrl);
        await commitFile(config, {
          path: config.sitemapPath,
          content: newSitemap,
          message: `SEO: sitemap +${article.slug}`,
        });
      }
    }

    return { ok: true, url: articleUrl, commitSha };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
