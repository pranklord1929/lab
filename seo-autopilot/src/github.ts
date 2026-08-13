import { Octokit } from "@octokit/rest";
import type { Config } from "./config.js";

function createOctokit(token: string) {
  return new Octokit({ auth: token });
}

export async function readFile(
  config: Config,
  path: string,
): Promise<string | null> {
  const octokit = createOctokit(config.githubToken);
  try {
    const { data } = await octokit.repos.getContent({
      owner: config.githubOwner,
      repo: config.githubRepo,
      path,
      ref: config.githubBranch,
    });
    if (Array.isArray(data) || data.type !== "file") return null;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

export async function commitFile(
  config: Config,
  opts: {
    path: string;
    content: string;
    message: string;
  },
): Promise<string> {
  const octokit = createOctokit(config.githubToken);
  const { path, content, message } = opts;

  let sha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({
      owner: config.githubOwner,
      repo: config.githubRepo,
      path,
      ref: config.githubBranch,
    });
    if (!Array.isArray(data) && data.type === "file") sha = data.sha;
  } catch {
    /* fichier inexistant — création */
  }

  const { data } = await octokit.repos.createOrUpdateFileContents({
    owner: config.githubOwner,
    repo: config.githubRepo,
    path,
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    sha,
    branch: config.githubBranch,
  });

  return data.commit.sha!;
}
