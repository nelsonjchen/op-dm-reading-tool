import { findCalibrationMessages, findDeviceType, type CalibrationMessage, type DeviceType } from "./capnp";
import { decompressLog } from "./decompress";
import { isInvalidCalibration } from "./format";
import {
  fetchRouteFiles,
  fetchRouteInfo,
  logSourceLabel,
  orderedLogUrls,
  orderedQcameraUrls,
  parseRouteInput,
  segmentFromUrl,
  type RouteInfo,
} from "./routes";

export interface ScanProgress {
  phase: "metadata" | "download" | "decode" | "done";
  message: string;
  current?: number;
  total?: number;
}

export interface CalibrationScanResult {
  routeName: string;
  routeInfo: RouteInfo | null;
  logUrl: string | null;
  logSource: "qlogs" | "rlogs";
  segment: number | null;
  message: CalibrationMessage | null;
  previousValid: CalibrationScanMessage | null;
  qcameraPreview: QcameraPreviewSource | null;
  readFailures: LogReadFailure[];
  scannedSegments: number;
  totalSegments: number;
  scanMode: "quick" | "full";
  resultType: "invalid" | "valid" | "incomplete";
  reason: "status-invalid" | "outside-current-limits" | "no-invalid-found" | "first-valid" | "scan-incomplete";
}

export interface QcameraPreviewSource {
  logUrl: string;
  segment: number;
  reason: "early-route" | "invalid-segment" | "unreadable-segment";
}

export interface CalibrationScanMessage {
  logUrl: string;
  segment: number;
  message: CalibrationMessage;
}

export interface LogReadFailure {
  logUrl: string;
  segment: number;
  message: string;
}

interface RouteLogContext {
  routeName: string;
  routeInfo: RouteInfo | null;
  logUrls: string[];
  qcameraUrls: string[];
  source: "qlogs" | "rlogs";
}

interface LogSegmentScan {
  calibrationMessages: CalibrationMessage[];
  deviceType: DeviceType | null;
}

export async function scanRouteForFirstValidCalibration(
  input: string,
  onProgress: (progress: ScanProgress) => void,
): Promise<CalibrationScanResult> {
  const context = await loadRouteLogContext(input, onProgress);

  for (let index = 0; index < context.logUrls.length; index += 1) {
    const logUrl = context.logUrls[index];
    const segment = segmentFromUrl(logUrl);
    const { calibrationMessages, deviceType } = await downloadLogSegmentScan(logUrl, segment, index, context.logUrls.length, context.source, onProgress);
    context.routeInfo = routeInfoWithDeviceType(context.routeInfo, context.routeName, deviceType);
    const message = calibrationMessages.find((calibration) => calibration.status === 1 && calibration.rpyCalib.length === 3);
    if (message) {
      onProgress({ phase: "done", message: `Found valid calibration in segment ${segment}` });
      return {
        routeName: context.routeName,
        routeInfo: context.routeInfo,
        logUrl,
        logSource: context.source,
        segment,
        message,
        previousValid: null,
        qcameraPreview: previewForSegment(context.qcameraUrls, 1, "early-route"),
        readFailures: [],
        scannedSegments: index + 1,
        totalSegments: context.logUrls.length,
        scanMode: "quick",
        resultType: "valid",
        reason: "first-valid",
      };
    }
  }

  throw new Error(`Scanned ${context.logUrls.length} uploaded ${logFileKind(context.source)} segment(s), but found no valid liveCalibration messages.`);
}

export async function scanRouteForInvalidCalibration(
  input: string,
  onProgress: (progress: ScanProgress) => void,
): Promise<CalibrationScanResult> {
  const context = await loadRouteLogContext(input, onProgress);
  let firstValid: CalibrationScanMessage | null = null;
  let lastValid: CalibrationScanMessage | null = null;
  let decodedSegments = 0;
  const readFailures: LogReadFailure[] = [];

  for (let index = 0; index < context.logUrls.length; index += 1) {
    const logUrl = context.logUrls[index];
    const segment = segmentFromUrl(logUrl);
    let calibrationMessages: CalibrationMessage[];
    try {
      const segmentScan = await downloadLogSegmentScan(logUrl, segment, index, context.logUrls.length, context.source, onProgress);
      calibrationMessages = segmentScan.calibrationMessages;
      context.routeInfo = routeInfoWithDeviceType(context.routeInfo, context.routeName, segmentScan.deviceType);
      decodedSegments += 1;
    } catch (error) {
      const failure = { logUrl, segment, message: readableLogError(error) };
      readFailures.push(failure);
      onProgress({
        phase: "decode",
        message: `Could not read ${logFileKind(context.source)} segment ${segment}: ${failure.message}`,
        current: index + 1,
        total: context.logUrls.length,
      });
      continue;
    }
    const message = calibrationMessages.find((calibration) => isInvalidCalibration(calibration, context.routeInfo));
    if (message) {
      const reason = message.status === 2 ? "status-invalid" : "outside-current-limits";
      const sameSegmentPreviousValid = calibrationMessages
        .filter((calibration) => calibration.status === 1 && calibration.logMonoTime < message.logMonoTime)
        .at(-1);
      onProgress({ phase: "done", message: `Found invalid calibration in segment ${segment}` });
      return {
        routeName: context.routeName,
        routeInfo: context.routeInfo,
        logUrl,
        logSource: context.source,
        segment,
        message,
        previousValid: sameSegmentPreviousValid ? { logUrl, segment, message: sameSegmentPreviousValid } : lastValid,
        qcameraPreview: previewForSegment(context.qcameraUrls, segment, "invalid-segment"),
        readFailures,
        scannedSegments: index + 1,
        totalSegments: context.logUrls.length,
        scanMode: "full",
        resultType: "invalid",
        reason,
      };
    }
    const validMessages = calibrationMessages.filter((calibration) => calibration.status === 1);
    if (validMessages.length > 0) {
      const validScans = validMessages.map((validMessage) => ({ logUrl, segment, message: validMessage }));
      firstValid ??= validScans[0];
      lastValid = validScans.at(-1) ?? lastValid;
    }
  }

  if (firstValid) {
    if (readFailures.length > 0) {
      onProgress({
        phase: "done",
        message: `No invalid calibration found in ${decodedSegments} decoded ${logFileKind(context.source)} segment(s), but ${readFailures.length} segment(s) could not be read.`,
      });
    } else {
      onProgress({ phase: "done", message: `No invalid calibration found in ${context.logUrls.length} ${logFileKind(context.source)} segment(s).` });
    }
    return {
      routeName: context.routeName,
      routeInfo: context.routeInfo,
      logUrl: firstValid.logUrl,
      logSource: context.source,
      segment: firstValid.segment,
      message: firstValid.message,
      previousValid: null,
      qcameraPreview:
        readFailures.length > 0
          ? previewForSegment(context.qcameraUrls, readFailures[0].segment, "unreadable-segment")
          : previewForSegment(context.qcameraUrls, 1, "early-route"),
      readFailures,
      scannedSegments: decodedSegments,
      totalSegments: context.logUrls.length,
      scanMode: "full",
      resultType: readFailures.length > 0 ? "incomplete" : "valid",
      reason: readFailures.length > 0 ? "scan-incomplete" : "no-invalid-found",
    };
  }

  if (readFailures.length > 0) {
    throw new Error(
      `Decoded ${decodedSegments} uploaded ${logFileKind(context.source)} segment(s) and skipped ${readFailures.length} unreadable segment(s), but found no invalid or valid liveCalibration messages.`,
    );
  }
  throw new Error(`Scanned ${decodedSegments} uploaded ${logFileKind(context.source)} segment(s), but found no invalid or valid liveCalibration messages.`);
}

async function loadRouteLogContext(
  input: string,
  onProgress: (progress: ScanProgress) => void,
): Promise<RouteLogContext> {
  const parsed = parseRouteInput(input);
  onProgress({ phase: "metadata", message: `Reading file list for ${parsed.routeName}` });

  const [routeInfo, files] = await Promise.all([fetchRouteInfo(parsed.routeName), fetchRouteFiles(parsed.routeName)]);
  const logUrls = orderedLogUrls(files);
  const qcameraUrls = orderedQcameraUrls(files);
  if (logUrls.length === 0) {
    throw new Error("No qlogs or rlogs are uploaded for this route.");
  }
  const source = logSourceLabel(files);
  if (source === "none") {
    throw new Error("No qlogs or rlogs are uploaded for this route.");
  }
  if (source === "rlogs") {
    onProgress({ phase: "metadata", message: "No qlogs found; falling back to rlogs." });
  }

  return { routeName: parsed.routeName, routeInfo, logUrls, qcameraUrls, source };
}

async function downloadLogSegmentScan(
  logUrl: string,
  segment: number,
  index: number,
  total: number,
  source: "qlogs" | "rlogs",
  onProgress: (progress: ScanProgress) => void,
): Promise<LogSegmentScan> {
  onProgress({
    phase: "download",
    message: `Downloading ${logFileKind(source)} segment ${segment} (${index + 1}/${total})`,
    current: index + 1,
    total,
  });

  const compressed = new Uint8Array(await (await fetchLog(logUrl)).arrayBuffer());
  onProgress({
    phase: "decode",
    message: `Decoding segment ${segment}`,
    current: index + 1,
    total,
  });

  const decompressed = decompressLog(compressed, logUrl);
  return {
    calibrationMessages: findCalibrationMessages(decompressed, (calibration) => calibration.rpyCalib.length === 3),
    deviceType: findDeviceType(decompressed),
  };
}

async function fetchLog(logUrl: string): Promise<Response> {
  const response = await fetch(logUrl);
  if (!response.ok) {
    throw new Error(`Could not download ${logUrl.split("?", 1)[0]} (${response.status}).`);
  }
  return response;
}

function logFileKind(source: "qlogs" | "rlogs"): "qlog" | "rlog" {
  return source === "qlogs" ? "qlog" : "rlog";
}

function readableLogError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("unexpected eof")) {
    return "unexpected EOF while decompressing; this log segment looks truncated";
  }
  return message;
}

function routeInfoWithDeviceType(routeInfo: RouteInfo | null, routeName: string, deviceType: DeviceType | null): RouteInfo | null {
  if (!deviceType || deviceType === "unknown" || routeInfo?.deviceType === deviceType) return routeInfo;
  return {
    fullname: routeInfo?.fullname ?? routeName,
    ...routeInfo,
    deviceType,
    devicetype: deviceType === "mici" ? 7 : routeInfo?.devicetype,
  };
}

function previewForSegment(
  qcameraUrls: string[],
  preferredSegment: number,
  reason: QcameraPreviewSource["reason"],
): QcameraPreviewSource | null {
  if (qcameraUrls.length === 0) return null;
  const exact = qcameraUrls.find((url) => segmentFromUrl(url) === preferredSegment);
  if (exact) return { logUrl: exact, segment: preferredSegment, reason };

  const nearest =
    qcameraUrls
      .map((url) => ({ url, segment: segmentFromUrl(url) }))
      .filter(({ segment }) => Number.isFinite(segment))
      .sort((a, b) => Math.abs(a.segment - preferredSegment) - Math.abs(b.segment - preferredSegment))[0] ?? null;
  return nearest ? { logUrl: nearest.url, segment: nearest.segment, reason } : null;
}
