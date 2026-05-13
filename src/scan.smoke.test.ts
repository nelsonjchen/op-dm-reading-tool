import { describe, expect, it } from "vitest";
import { scanRouteForInvalidCalibration } from "./scan";

describe("demo route smoke", () => {
  it(
    "reports a valid route when no invalid calibration is found",
    async () => {
      const result = await scanRouteForInvalidCalibration("5beb9b58bd12b691|0000010a--a51155e496", () => {});
      expect(result.resultType).toBe("valid");
      if (!result.message) throw new Error("Expected a valid calibration message");
      expect(result.message.statusName).toBe("calibrated");
      expect(result.message.rpyCalib).toHaveLength(3);
    },
    60_000,
  );
});
