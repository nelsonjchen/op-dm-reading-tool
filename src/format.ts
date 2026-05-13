import { CALIBRATION_LIMITS } from "./constants";
import type { CalibrationMessage } from "./capnp";
import type { RouteInfo } from "./routes";

export function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

export function formatDegrees(value: number): string {
  return `${radiansToDegrees(value).toFixed(2)}°`;
}

export function formatAngle(value: number | undefined): string {
  return value === undefined ? "n/a" : formatDegrees(value);
}

export function formatLogMonoTime(value: bigint): string {
  return `${value.toString()} ns`;
}

export function deviceLimitKey(routeInfo: RouteInfo | null): keyof typeof CALIBRATION_LIMITS {
  return routeInfo?.devicetype === 7 ? "mici" : "default";
}

export function yawDirection(yaw: number): string {
  if (Math.abs(yaw) < 0.0001) return "centered";
  return yaw > 0 ? "left" : "right";
}

export function pitchDirection(pitch: number): string {
  if (Math.abs(pitch) < 0.0001) return "level";
  return pitch > 0 ? "down" : "up";
}

export function withinLimits(message: CalibrationMessage, routeInfo: RouteInfo | null): boolean {
  const limits = CALIBRATION_LIMITS[deviceLimitKey(routeInfo)];
  const pitch = message.rpyCalib[1];
  const yaw = message.rpyCalib[2];
  if (!Number.isFinite(pitch) || !Number.isFinite(yaw)) return false;
  return pitch > limits.pitchMinRad && pitch < limits.pitchMaxRad && yaw > limits.yawMinRad && yaw < limits.yawMaxRad;
}

export function isInvalidCalibration(message: CalibrationMessage, routeInfo: RouteInfo | null): boolean {
  return message.rpyCalib.length === 3 && (message.status === 2 || !withinLimits(message, routeInfo));
}
