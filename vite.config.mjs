import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";

function environmentValue(...names) {
  return names.map((name) => process.env[name]?.trim()).find(Boolean) ?? "";
}

function gitValue(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function normalizeRemoteUrl(remoteUrl) {
  const sshMatch = remoteUrl.match(/^git@([^:]+):(.+)$/);
  const normalized = sshMatch ? `https://${sshMatch[1]}/${sshMatch[2]}` : remoteUrl;
  return normalized.endsWith(".git") ? normalized.slice(0, -4) : normalized;
}

function buildInfo() {
  const githubRemote = environmentValue("GITHUB_SERVER_URL") && environmentValue("GITHUB_REPOSITORY")
    ? `${environmentValue("GITHUB_SERVER_URL")}/${environmentValue("GITHUB_REPOSITORY")}`
    : "";
  return {
    remoteUrl: normalizeRemoteUrl(environmentValue("VITE_GIT_REMOTE_URL") || gitValue(["config", "--get", "remote.origin.url"]) || githubRemote),
    branch: environmentValue("VITE_GIT_BRANCH", "CF_PAGES_BRANCH", "GITHUB_REF_NAME") || gitValue(["branch", "--show-current"]) || "unknown",
    commit: environmentValue("VITE_GIT_COMMIT", "CF_PAGES_COMMIT_SHA", "GITHUB_SHA") || gitValue(["rev-parse", "HEAD"]) || "unknown",
  };
}

export default defineConfig({
  base: "/",
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo()),
  },
});
