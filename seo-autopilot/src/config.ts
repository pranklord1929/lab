import "dotenv/config";

export type Config = {
  llmProvider: "anthropic" | "deepseek";
  anthropicApiKey?: string;
  anthropicModel: string;
  deepseekApiKey?: string;
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  siteTone: string;
  blogDir: string;
  blogIndexPath: string;
  blogIndexAnchor: string;
  sitemapPath?: string;
};

export function loadConfig(): Config {
  const required = [
    "GITHUB_TOKEN",
    "GITHUB_OWNER",
    "GITHUB_REPO",
    "SITE_NAME",
    "SITE_URL",
    "SITE_DESCRIPTION",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Variables manquantes dans .env : ${missing.join(", ")}\n` +
        "Copie .env.example → .env et remplis les valeurs.",
    );
  }

  const provider = (process.env.LLM_PROVIDER ?? "anthropic") as
    | "anthropic"
    | "deepseek";

  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY manquant dans .env");
  }
  if (provider === "deepseek" && !process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY manquant dans .env");
  }

  return {
    llmProvider: provider,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    githubToken: process.env.GITHUB_TOKEN!,
    githubOwner: process.env.GITHUB_OWNER!,
    githubRepo: process.env.GITHUB_REPO!,
    githubBranch: process.env.GITHUB_BRANCH ?? "main",
    siteName: process.env.SITE_NAME!,
    siteUrl: process.env.SITE_URL!.replace(/\/$/, ""),
    siteDescription: process.env.SITE_DESCRIPTION!,
    siteTone: process.env.SITE_TONE ?? "professionnel et accessible",
    blogDir: process.env.BLOG_DIR ?? "blog",
    blogIndexPath: process.env.BLOG_INDEX_PATH ?? "blog/index.html",
    blogIndexAnchor: process.env.BLOG_INDEX_ANCHOR ?? '<div class="post-list">',
    sitemapPath: process.env.SITEMAP_PATH || undefined,
  };
}
