import { API_BASE_URL } from "./constants";

export interface ParsedRouteInput {
  routeName: string;
  dongleId: string;
  routeId: string;
  source: "route" | "connect-url";
}

export interface RouteFiles {
  cameras?: string[];
  dcameras?: string[];
  ecameras?: string[];
  logs?: string[];
  qcameras?: string[];
  qlogs?: string[];
}

export interface RouteInfo {
  fullname: string;
  deviceType?: string;
  dongle_id?: string;
  dongleId?: string;
  devicetype?: number;
  maxlog?: number;
  maxqlog?: number;
  platform?: string;
  version?: string;
  git_commit?: string;
  gitCommit?: string;
  git_branch?: string;
  gitBranch?: string;
}

export function parseRouteInput(input: string): ParsedRouteInput {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Paste a public comma Connect URL or route name first.");

  if (trimmed.startsWith("https://connect.comma.ai/")) {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      throw new Error("Connect URLs need at least /<dongle>/<route> in the path.");
    }
    const [dongleId, routeId] = parts;
    return {
      routeName: `${dongleId}|${routeId}`,
      dongleId,
      routeId,
      source: "connect-url",
    };
  }

  const routeName = trimmed.replace("/", "|");
  const [dongleId, routeId] = routeName.split("|");
  if (!dongleId || !routeId) {
    throw new Error("Route names should look like dongle_id|route_id.");
  }

  return {
    routeName,
    dongleId,
    routeId,
    source: "route",
  };
}

export async function fetchRouteFiles(routeName: string): Promise<RouteFiles> {
  const response = await fetch(`${API_BASE_URL}/v1/route/${encodeURIComponent(routeName)}/files`);
  if (!response.ok) {
    throw new Error(
      `Could not read route files (${response.status}). Make sure the route is public and its logs are uploaded.`,
    );
  }
  return response.json();
}

export async function fetchRouteInfo(routeName: string): Promise<RouteInfo | null> {
  const response = await fetch(`${API_BASE_URL}/v1/route/${encodeURIComponent(routeName)}/`);
  if (!response.ok) return null;
  return response.json();
}

export function orderedLogUrls(files: RouteFiles): string[] {
  const qlogs = sortBySegment(files.qlogs ?? []);
  if (qlogs.length > 0) return qlogs;
  return sortBySegment(files.logs ?? []);
}

export function orderedQcameraUrls(files: RouteFiles): string[] {
  return sortBySegment(files.qcameras ?? []);
}

export function logSourceLabel(files: RouteFiles): "qlogs" | "rlogs" | "none" {
  if ((files.qlogs ?? []).length > 0) return "qlogs";
  if ((files.logs ?? []).length > 0) return "rlogs";
  return "none";
}

export function segmentFromUrl(url: string): number {
  const match = url.match(/\/(\d+)\/(?:qlog|rlog|qcamera)\.(?:bz2|zst|ts)(?:\?|$)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function sortBySegment(urls: string[]): string[] {
  return [...urls].sort((a, b) => segmentFromUrl(a) - segmentFromUrl(b));
}
