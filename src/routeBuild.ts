import type { RouteInfo } from "./routes";

export interface RecordedBuildInfo {
  remoteUrl?: string;
  branch?: string;
  commit?: string;
}

export function recordedBuildInfo(routeInfo: RouteInfo | null): RecordedBuildInfo {
  return {
    remoteUrl: normalizeGitRemote(routeInfo?.git_remote ?? routeInfo?.gitRemote),
    branch: routeInfo?.git_branch ?? routeInfo?.gitBranch,
    commit: routeInfo?.git_commit ?? routeInfo?.gitCommit,
  };
}

export function normalizeGitRemote(remote: string | undefined): string | undefined {
  const trimmed = remote?.trim().replace(/\.git$/, "");
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}
