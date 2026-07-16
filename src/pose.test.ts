import { describe, expect, it } from "vitest";
import type { DriverModelData, DriverModelSample, DriverMonitoringSample } from "./dm";
import { collectPoseHistory, formatAbsoluteDegrees, formatPitchDegrees, formatSignedDegrees, poseVectorGeometry, poseWidgetLayout, poseYawForVideo, ticiFacePolyline } from "./pose";

const driver = (pitch: number, uncertainty = 0.1): DriverModelData => ({
  faceOrientation: [pitch, 0.2, -0.05],
  faceOrientationStd: [uncertainty, uncertainty, uncertainty],
  facePosition: [0, 0],
  facePositionStd: [0, 0],
  faceProb: 1,
  leftEyeProb: 1,
  rightEyeProb: 1,
  leftBlinkProb: 0,
  rightBlinkProb: 0,
  sunglassesProb: 0,
  phoneProb: 0,
});

const model = (routeSeconds: number, leftPitch: number, rightPitch = 0): DriverModelSample => ({
  logMonoTime: BigInt(routeSeconds * 1e9),
  routeSeconds,
  wheelOnRightProb: 0,
  modelExecutionTime: 0,
  gpuExecutionTime: 0,
  left: driver(leftPitch),
  right: driver(rightPitch),
});

const monitor = (routeSeconds: number, overrides: Partial<DriverMonitoringSample> = {}): DriverMonitoringSample => ({
  logMonoTime: BigInt(routeSeconds * 1e9),
  routeSeconds,
  schema: "modern",
  alertLevel: "none",
  activePolicy: "vision",
  lockout: false,
  alwaysOnLockout: false,
  isRhd: false,
  faceDetected: true,
  isDistracted: false,
  distractedTypes: [],
  awareness: 1,
  awarenessVision: 1,
  awarenessWheel: 1,
  awarenessStep: 0,
  fallbackPercent: 0,
  uncertainPercent: 0,
  posePitch: -0.1,
  poseYaw: 0.2,
  poseUncertainty: 0.1,
  poseCalibrated: true,
  pitchOffset: -0.04,
  pitchCalibratedPercent: 100,
  yawOffset: 0,
  yawCalibratedPercent: 100,
  ...overrides,
});

describe("pose visualization", () => {
  it("maps negative pitch downward and positive yaw to the right", () => {
    const geometry = poseVectorGeometry(-Math.PI / 12, Math.PI / 18, Math.PI / 36, 0.1);
    expect(geometry).not.toBeNull();
    expect(geometry!.endX).toBeGreaterThan(50);
    expect(geometry!.endY).toBeGreaterThan(50);
    expect(geometry!.rollDegrees).toBeCloseTo(5);
    expect(geometry!.uncertaintyRadius).toBeGreaterThan(4);
  });

  it("clamps the visual vector while preserving the measured values", () => {
    const geometry = poseVectorGeometry(-Math.PI, Math.PI, 0, 10)!;
    expect(geometry.endX).toBe(81);
    expect(geometry.endY).toBe(81);
    expect(geometry.pitchDegrees).toBeCloseTo(-180);
    expect(geometry.yawDegrees).toBeCloseTo(180);
    expect(geometry.uncertaintyRadius).toBe(14);
  });

  it("maps DM yaw back onto the video direction for each driver side", () => {
    expect(poseYawForVideo(0.5, "dm", false)).toBe(-0.5);
    expect(poseYawForVideo(0.5, "dm", true)).toBe(0.5);
    expect(poseYawForVideo(0.5, "raw", false)).toBe(0.5);
  });

  it("builds the same closed 33-point face outline used by the Tici widget", () => {
    const points = ticiFacePolyline([0, 0, 0]).split(" ");
    expect(points).toHaveLength(33);
    expect(points[0]).toBe(points.at(-1));
    expect(ticiFacePolyline([0.2, -0.3, 0.1])).not.toBe(ticiFacePolyline([0, 0, 0]));
    expect(ticiFacePolyline([])).toBe("");
  });

  it("places the widget outside the face box on the driver-side edge", () => {
    const lhd = poseWidgetLayout(65, 10, false);
    const rhd = poseWidgetLayout(35, 10, true);
    expect(lhd.placement).toBe("right");
    expect(lhd.centerX - lhd.width / 2).toBeGreaterThan(70);
    expect(rhd.placement).toBe("left");
    expect(rhd.centerX + rhd.width / 2).toBeLessThan(30);
    expect(poseWidgetLayout(98, 10, false).centerX).toBeLessThan(100);
  });

  it("formats signed values and calls out downward pitch", () => {
    expect(formatSignedDegrees(0.1)).toBe("+5.7°");
    expect(formatAbsoluteDegrees(-0.1)).toBe("5.7°");
    expect(formatPitchDegrees(-0.1)).toBe("5.7° DOWN");
    expect(formatPitchDegrees(0)).toBe("0.0° LEVEL");
  });

  it("keeps raw model pitch separate from the DM-corrected pitch and learned offset", () => {
    const result = collectPoseHistory(
      [model(10, -0.2), model(11, -0.3, 0.4)],
      [monitor(9), monitor(10, { posePitch: -0.08 }), monitor(11, { isRhd: true, posePitch: -0.12, pitchOffset: -0.03, distractedTypes: ["pose"] })],
      10,
      11,
    );
    expect(result.raw.map((point) => point.pitch)).toEqual([-0.2, 0.4]);
    expect(result.dm).toEqual([
      { routeSeconds: 10, pitch: -0.08, neutralOffset: -0.04, poseDistracted: false },
      { routeSeconds: 11, pitch: -0.12, neutralOffset: -0.03, poseDistracted: true },
    ]);
  });

  it("omits DM pose fields that did not exist in the legacy state", () => {
    const result = collectPoseHistory([model(10, -0.2)], [monitor(10, { schema: "legacy" })], 0, 20);
    expect(result.raw).toHaveLength(1);
    expect(result.dm).toEqual([]);
  });
});
