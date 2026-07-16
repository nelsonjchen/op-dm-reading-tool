import { sampleAt, selectDriver, type DriverModelSample, type DriverMonitoringSample } from "./dm";

const DEGREES_PER_RADIAN = 180 / Math.PI;
const VECTOR_LIMIT_DEGREES = 35;
const VECTOR_RADIUS = 31;
const TICI_FACE_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [-5.98, -51.20, 8], [-17.64, -49.14, 8], [-23.81, -46.40, 8], [-29.98, -40.91, 8],
  [-32.04, -37.49, 8], [-34.10, -32, 8], [-36.16, -21.03, 8], [-36.16, 6.40, 8],
  [-35.47, 10.51, 8], [-32.73, 19.43, 8], [-29.30, 26.29, 8], [-24.50, 33.83, 8],
  [-19.01, 41.37, 8], [-14.21, 46.17, 8], [-12.16, 47.54, 8], [-4.61, 49.60, 8],
  [4.99, 49.60, 8], [12.53, 47.54, 8], [14.59, 46.17, 8], [19.39, 41.37, 8],
  [24.87, 33.83, 8], [29.67, 26.29, 8], [33.10, 19.43, 8], [35.84, 10.51, 8],
  [36.53, 6.40, 8], [36.53, -21.03, 8], [34.47, -32, 8], [32.42, -37.49, 8],
  [30.36, -40.91, 8], [24.19, -46.40, 8], [18.02, -49.14, 8], [6.36, -51.20, 8],
  [-5.98, -51.20, 8],
];
const TICI_SCALES_POSITIVE = [0.9, 0.4, 0.4] as const;
const TICI_SCALES_NEGATIVE = [0.7, 0.4, 0.4] as const;

export type PoseOverlayMode = "dm" | "raw";

export interface PoseVectorGeometry {
  pitchDegrees: number;
  yawDegrees: number;
  rollDegrees: number;
  endX: number;
  endY: number;
  uncertaintyRadius: number;
}

export interface RawPitchPoint {
  routeSeconds: number;
  pitch: number;
  uncertainty: number;
}

export interface DmPitchPoint {
  routeSeconds: number;
  pitch: number;
  neutralOffset: number;
  poseDistracted: boolean;
}

export interface PoseWidgetLayout {
  centerX: number;
  width: number;
  placement: "left" | "right";
}

export function radiansToDegrees(radians: number): number {
  return radians * DEGREES_PER_RADIAN;
}

export function formatSignedDegrees(radians: number | undefined, fractionDigits = 1): string {
  if (radians === undefined || !Number.isFinite(radians)) return "--";
  const degrees = radiansToDegrees(radians);
  const normalized = Math.abs(degrees) < 0.05 ? 0 : degrees;
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(fractionDigits)}°`;
}

export function formatAbsoluteDegrees(radians: number | undefined, fractionDigits = 1): string {
  if (radians === undefined || !Number.isFinite(radians)) return "--";
  return `${Math.abs(radiansToDegrees(radians)).toFixed(fractionDigits)}°`;
}

export function formatPitchDegrees(radians: number | undefined): string {
  if (radians === undefined || !Number.isFinite(radians)) return "--";
  const degrees = radiansToDegrees(radians);
  if (Math.abs(degrees) < 0.5) return `${formatSignedDegrees(radians)} LEVEL`;
  return `${Math.abs(degrees).toFixed(1)}° ${degrees < 0 ? "DOWN" : "UP"}`;
}

export function poseVectorGeometry(
  pitch: number | undefined,
  yaw: number | undefined,
  roll: number | undefined,
  uncertainty: number | undefined,
): PoseVectorGeometry | null {
  if (pitch === undefined || yaw === undefined || !Number.isFinite(pitch) || !Number.isFinite(yaw)) return null;
  const pitchDegrees = radiansToDegrees(pitch);
  const yawDegrees = radiansToDegrees(yaw);
  const rollDegrees = roll !== undefined && Number.isFinite(roll) ? radiansToDegrees(roll) : 0;
  const uncertaintyDegrees = uncertainty !== undefined && Number.isFinite(uncertainty)
    ? Math.max(0, radiansToDegrees(uncertainty))
    : 0;
  const clampedPitch = Math.max(-VECTOR_LIMIT_DEGREES, Math.min(VECTOR_LIMIT_DEGREES, pitchDegrees));
  const clampedYaw = Math.max(-VECTOR_LIMIT_DEGREES, Math.min(VECTOR_LIMIT_DEGREES, yawDegrees));
  return {
    pitchDegrees,
    yawDegrees,
    rollDegrees,
    endX: 50 + (clampedYaw / VECTOR_LIMIT_DEGREES) * VECTOR_RADIUS,
    // Negative pitch is the downward direction evaluated by openpilot's DM policy.
    endY: 50 - (clampedPitch / VECTOR_LIMIT_DEGREES) * VECTOR_RADIUS,
    uncertaintyRadius: Math.max(4, Math.min(14, 4 + uncertaintyDegrees * 0.55)),
  };
}

export function poseYawForVideo(yaw: number, mode: PoseOverlayMode, isRhd: boolean): number {
  // DM flips yaw for right-hand-drive policy symmetry. Convert that policy axis
  // back into the camera's left/right screen direction before drawing it.
  return mode === "dm" ? yaw * (isRhd ? 1 : -1) : yaw;
}

export function poseWidgetLayout(boxCenter: number, boxWidth: number, isRhd: boolean): PoseWidgetLayout {
  const width = boxWidth * 0.82;
  const gap = Math.max(0.8, boxWidth * 0.12);
  const direction = isRhd ? -1 : 1;
  const desiredCenter = boxCenter + direction * (boxWidth / 2 + gap + width / 2);
  return {
    centerX: Math.max(width / 2 + 0.6, Math.min(100 - width / 2 - 0.6, desiredCenter)),
    width,
    placement: isRhd ? "left" : "right",
  };
}

export function ticiFacePolyline(orientation: readonly number[]): string {
  if (orientation.length < 3 || !orientation.slice(0, 3).every(Number.isFinite)) return "";
  const pose = orientation.slice(0, 3).map((value, index) => value * (value < 0 ? TICI_SCALES_NEGATIVE[index] : TICI_SCALES_POSITIVE[index]));
  const [angleY, angleX, angleZ] = pose;
  const sinY = Math.sin(angleY);
  const sinX = Math.sin(angleX);
  const sinZ = Math.sin(angleZ);
  const cosY = Math.cos(angleY);
  const cosX = Math.cos(angleX);
  const cosZ = Math.cos(angleZ);
  // This is the same rotation matrix used by openpilot's Tici DriverStateRenderer.
  const rotation = [
    [cosX * cosZ, cosX * sinZ, -sinX],
    [-sinY * sinX * cosZ - cosY * sinZ, -sinY * sinX * sinZ + cosY * cosZ, -sinY * cosX],
    [cosY * sinX * cosZ - sinY * sinZ, cosY * sinX * sinZ + sinY * cosZ, cosY * cosX],
  ];
  return TICI_FACE_POINTS.map(([x, y, z]) => {
    const rotatedX = x * rotation[0][0] + y * rotation[0][1] + z * rotation[0][2];
    const rotatedY = x * rotation[1][0] + y * rotation[1][1] + z * rotation[1][2];
    const rotatedZ = x * rotation[2][0] + y * rotation[2][1] + z * rotation[2][2];
    const depth = (rotatedZ - 8) / 120 + 1;
    return `${(50 + rotatedX * depth * 0.62).toFixed(2)},${(50 + rotatedY * depth * 0.62).toFixed(2)}`;
  }).join(" ");
}

export function collectPoseHistory(
  models: DriverModelSample[],
  monitoring: DriverMonitoringSample[],
  startSeconds: number,
  endSeconds: number,
): { raw: RawPitchPoint[]; dm: DmPitchPoint[] } {
  const raw = models.flatMap<RawPitchPoint>((model) => {
    if (model.routeSeconds < startSeconds || model.routeSeconds > endSeconds) return [];
    const monitor = sampleAt(monitoring, model.routeSeconds);
    const { selected } = selectDriver(model, monitor);
    const pitch = selected?.faceOrientation[0];
    if (pitch === undefined || !Number.isFinite(pitch)) return [];
    const uncertainty = selected?.faceOrientationStd[0];
    return [{
      routeSeconds: model.routeSeconds,
      pitch,
      uncertainty: uncertainty !== undefined && Number.isFinite(uncertainty) ? Math.max(0, uncertainty) : 0,
    }];
  });
  const dm = monitoring.flatMap<DmPitchPoint>((sample) => {
    if (sample.schema !== "modern" || sample.routeSeconds < startSeconds || sample.routeSeconds > endSeconds) return [];
    if (!Number.isFinite(sample.posePitch) || !Number.isFinite(sample.pitchOffset)) return [];
    return [{
      routeSeconds: sample.routeSeconds,
      pitch: sample.posePitch,
      neutralOffset: sample.pitchOffset,
      poseDistracted: sample.distractedTypes.includes("pose"),
    }];
  });
  return { raw, dm };
}
