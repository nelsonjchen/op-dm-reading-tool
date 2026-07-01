import { describe, expect, it } from "vitest";
import { adjustmentHint } from "./format";

describe("adjustment hints", () => {
  it("describes negative yaw correction as counterclockwise left", () => {
    expect(adjustmentHint(-0.02, "yaw")).toBe("To get closer to 0°, twist the device counterclockwise to the left.");
  });

  it("describes positive yaw correction as clockwise right", () => {
    expect(adjustmentHint(0.02, "yaw")).toBe("To get closer to 0°, twist the device clockwise to the right.");
  });

  it("keeps near-zero yaw neutral", () => {
    expect(adjustmentHint(0.00001, "yaw")).toBe("Already near 0°.");
  });
});
