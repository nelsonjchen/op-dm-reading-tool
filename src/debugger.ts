import { decompressLog } from "./decompress";
import { decodeDriverDebugSegment, type DriverDebugSegment, type DriverModelSample, type DriverMonitoringSample, type DriverVideoFrameIndex, type VehicleSample } from "./dm";
import { fetchRouteFiles, fetchRouteInfo, logSourceLabel, orderedDcameraUrls, orderedLogUrls, parseRouteInput, segmentFromUrl, type RouteInfo } from "./routes";

export interface DebugLoadProgress {
  message: string;
  fraction: number;
}

export interface DriverDebugLoadOptions {
  highResolutionTelemetry?: boolean;
}

export interface DriverDebugRoute {
  routeName: string;
  routeInfo: RouteInfo | null;
  startSeconds: number;
  endSeconds: number;
  logSource: "qlogs" | "rlogs";
  telemetryHz: number;
  highResolutionRequested: boolean;
  monitoring: DriverMonitoringSample[];
  models: DriverModelSample[];
  vehicles: VehicleSample[];
  videoSources: Array<{ segment: number; url: string; frames: DriverVideoFrameIndex[] }>;
  segments: DriverDebugSegment[];
}

export async function loadDriverDebugRoute(
  input: string,
  onProgress: (progress: DebugLoadProgress) => void = () => {},
  options: DriverDebugLoadOptions = {},
): Promise<DriverDebugRoute> {
  const parsed = parseRouteInput(input);
  onProgress({ message: "Reading route file list", fraction: 0.03 });
  const [routeInfo, files] = await Promise.all([fetchRouteInfo(parsed.routeName), fetchRouteFiles(parsed.routeName)]);
  const highResolutionRequested = options.highResolutionTelemetry ?? false;
  const logSource = logSourceLabel(files, highResolutionRequested);
  if (logSource === "none") throw new Error("No qlogs or rlogs are uploaded for this route.");
  const logUrls = new Map(orderedLogUrls(files, highResolutionRequested).map((url) => [segmentFromUrl(url), url]));
  const dcameraUrls = new Map(orderedDcameraUrls(files).map((url) => [segmentFromUrl(url), url]));
  if (dcameraUrls.size === 0) throw new Error("No driver-camera video is uploaded for this route. Enable driver camera recording before the drive.");

  const historyStart = Math.max(0, parsed.startSeconds - 20);
  const firstSegment = Math.floor(historyStart / 60);
  const lastSegment = Math.floor(Math.max(parsed.startSeconds, parsed.endSeconds - 0.001) / 60);
  const wantedSegments = Array.from({ length: lastSegment - firstSegment + 1 }, (_, index) => firstSegment + index);
  const decoded: DriverDebugSegment[] = [];

  for (let index = 0; index < wantedSegments.length; index += 1) {
    const segment = wantedSegments[index];
    const logUrl = logUrls.get(segment);
    if (!logUrl) continue;
    onProgress({
      message: `Downloading ${logSource === "qlogs" ? "qlog" : "rlog"} segment ${segment}`,
      fraction: 0.08 + (index / wantedSegments.length) * 0.45,
    });
    const response = await fetch(logUrl);
    if (!response.ok) throw new Error(`Could not download log segment ${segment} (${response.status}).`);
    const compressed = new Uint8Array(await response.arrayBuffer());
    const bytes = decompressLog(compressed, logUrl);
    decoded.push(decodeDriverDebugSegment(bytes, segment));
  }

  if (decoded.length === 0) throw new Error("No uploaded logs overlap this clip range.");
  const monitoring = decoded.flatMap((segment) => segment.monitoring).sort(byRouteSeconds);
  const models = decoded.flatMap((segment) => segment.models).sort(byRouteSeconds);
  const vehicles = decoded.flatMap((segment) => segment.vehicles).sort(byRouteSeconds);
  if (monitoring.length === 0 || models.length === 0) {
    throw new Error("The selected logs do not contain Driver Monitoring state and driver model samples.");
  }

  const videoSources = decoded.flatMap((segment) => {
    const url = dcameraUrls.get(segment.segment);
    return url && segment.videoFrames.length > 0 ? [{ segment: segment.segment, url, frames: segment.videoFrames }] : [];
  });
  if (videoSources.length === 0) throw new Error("Driver video exists, but its frame index is missing for this clip.");

  onProgress({ message: "Driver Monitoring timeline ready", fraction: 0.55 });
  return {
    routeName: parsed.routeName,
    routeInfo,
    startSeconds: parsed.startSeconds,
    endSeconds: parsed.endSeconds,
    logSource,
    telemetryHz: estimateSampleRate(models.length >= monitoring.length ? models : monitoring),
    highResolutionRequested,
    monitoring,
    models,
    vehicles,
    videoSources,
    segments: decoded,
  };
}

function estimateSampleRate(samples: Array<{ routeSeconds: number }>): number {
  const deltas = samples.slice(1).flatMap((sample, index) => {
    const delta = sample.routeSeconds - samples[index].routeSeconds;
    return delta > 0.001 && delta < 2 ? [delta] : [];
  }).sort((a, b) => a - b);
  if (deltas.length === 0) return 0;
  const median = deltas[Math.floor(deltas.length / 2)];
  return Math.round((1 / median) * 10) / 10;
}

function byRouteSeconds<T extends { routeSeconds: number }>(a: T, b: T): number {
  return a.routeSeconds - b.routeSeconds;
}
