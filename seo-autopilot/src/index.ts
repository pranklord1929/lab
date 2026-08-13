import { createInterface } from "readline/promises";
import { loadConfig } from "./config.js";
import { proposeTopics, generateArticle, type SeoTopic } from "./seo.js";
import { publishArticle } from "./publisher.js";

const INTENT_LABEL: Record<string, string> = {
  local: "local",
  informational: "informatif",
  transactional: "transactionnel",
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║        SEO Autopilot — CLI           ║");
  console.log("╚══════════════════════════════════════╝\n");

  // Chargement config
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error("Erreur de configuration :", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const llmLabel =
    config.llmProvider === "anthropic"
      ? `Claude ${config.anthropicModel}`
      : "DeepSeek";

  console.log(`Site    : ${config.siteName} (${config.siteUrl})`);
  console.log(`GitHub  : ${config.githubOwner}/${config.githubRepo} [${config.githubBranch}]`);
  console.log(`LLM     : ${llmLabel}\n`);

  let topics: SeoTopic[] = [];

  while (true) {
    // Propose des sujets
    console.log("Génération de 5 sujets d'articles...\n");
    try {
      topics = await proposeTopics(config, 5);
    } catch (err) {
      console.error("Erreur LLM :", err instanceof Error ? err.message : err);
      rl.close();
      process.exit(1);
    }

    console.log("Sujets proposés :\n");
    topics.forEach((t, i) => {
      const intent = INTENT_LABEL[t.intent] ?? t.intent;
      console.log(`  ${i + 1}. ${t.title}`);
      console.log(`     Angle   : ${t.angle}`);
      console.log(`     Mot-clé : ${t.targetKeyword} [${intent}]\n`);
    });

    const choice = (
      await rl.question("Choisis un sujet (1-5) ou tape \"r\" pour en avoir de nouveaux : ")
    ).trim().toLowerCase();

    if (choice === "r" || choice === "refresh") continue;

    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= topics.length) {
      console.log('Choix invalide. Tape un chiffre entre 1 et 5, ou "r" pour recharger.\n');
      continue;
    }

    const topic = topics[idx];

    // Génération de l'article
    console.log(`\nRédaction de l'article "${topic.title}"...\n`);
    let article;
    try {
      article = await generateArticle(config, topic);
    } catch (err) {
      console.error("Erreur génération :", err instanceof Error ? err.message : err);
      rl.close();
      process.exit(1);
    }

    // Aperçu
    console.log("─".repeat(52));
    console.log(`Titre      : ${article.title}`);
    console.log(`Slug       : ${article.slug}`);
    console.log(`Meta       : ${article.metaDescription}`);
    console.log(`Mot-clé    : ${article.targetKeyword}`);
    console.log(`Lecture    : ~${article.readingMinutes} min`);
    console.log("─".repeat(52));
    console.log(`\nAperçu :\n${stripHtml(article.bodyHtml)}...\n`);

    const confirm = (
      await rl.question("Publier cet article sur GitHub ? (o/n) : ")
    ).trim().toLowerCase();

    if (confirm !== "o" && confirm !== "oui" && confirm !== "y" && confirm !== "yes") {
      console.log("\nPublication annulée.\n");
      const again = (
        await rl.question("Recommencer avec de nouveaux sujets ? (o/n) : ")
      ).trim().toLowerCase();
      if (again === "o" || again === "oui" || again === "y" || again === "yes") {
        console.log("");
        continue;
      }
      break;
    }

    // Publication
    console.log("\nCommit en cours...");
    const result = await publishArticle(config, article);

    if (result.ok) {
      console.log(`\nArticle publié avec succès !`);
      console.log(`URL     : ${result.url}`);
      console.log(`Commit  : ${result.commitSha.slice(0, 7)}\n`);
    } else {
      console.error(`\nErreur lors de la publication : ${result.error}\n`);
    }

    const again = (
      await rl.question("Générer un autre article ? (o/n) : ")
    ).trim().toLowerCase();
    if (again !== "o" && again !== "oui" && again !== "y" && again !== "yes") break;
    console.log("");
  }

  console.log("\nMerci d'avoir utilisé SEO Autopilot. Bye !\n");
  rl.close();
}

main().catch((err) => {
  console.error("Erreur fatale :", err);
  process.exit(1);
});
