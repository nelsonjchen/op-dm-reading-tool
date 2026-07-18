import { describe, expect, it } from "vitest";
import { computePictureBox } from "./picture-box";

describe("computePictureBox", () => {
  it("returns null before intrinsic dimensions are known", () => {
    expect(computePictureBox(0, 0, 800, 600, 0, 0)).toBeNull();
    expect(computePictureBox(0, 0, 800, 600, 1928, 0)).toBeNull();
    expect(computePictureBox(0, 0, 800, 600, 0, 1208)).toBeNull();
  });

  it("returns null for a zero-size video box", () => {
    expect(computePictureBox(0, 0, 0, 0, 1928, 1208)).toBeNull();
  });

  it("fills the box when ratios match (no letterboxing)", () => {
    // Video element 1928x1208, intrinsic 1928x1208 → picture == element.
    const box = computePictureBox(10, 20, 1928, 1208, 1928, 1208)!;
    expect(box).toEqual({ left: 10, top: 20, width: 1928, height: 1208 });
  });

  it("pillarboxes when the element is wider than the picture (the drift case)", () => {
    // Short viewport: shell wider than video ratio. Intrinsic 1928x1208
    // (ratio ~1.596), element 1928x576 (ratio ~3.347) → height-bound,
    // bars on the sides. This is the case where `%`-of-shell overlays drift.
    const intrinsicRatio = 1928 / 1208;
    const box = computePictureBox(0, 0, 1928, 576, 1928, 1208)!;
    expect(box.height).toBe(576);
    expect(box.width).toBeCloseTo(576 * intrinsicRatio, 5);
    // Centered horizontally: equal side gaps.
    expect(box.left).toBeCloseTo((1928 - box.width) / 2, 5);
    expect(box.top).toBe(0);
  });

  it("letterboxes when the element is taller than the picture", () => {
    // Narrow/tall element: intrinsic 1928x1208, element 800x1208 →
    // width-bound, bars top and bottom.
    const intrinsicRatio = 1928 / 1208;
    const box = computePictureBox(0, 0, 800, 1208, 1928, 1208)!;
    expect(box.width).toBe(800);
    expect(box.height).toBeCloseTo(800 / intrinsicRatio, 5);
    expect(box.top).toBeCloseTo((1208 - box.height) / 2, 5);
    expect(box.left).toBe(0);
  });

  it("pillarboxes a portrait video inside a squarish element", () => {
    // Intrinsic 720x1280 (ratio 0.5625), element 1080x1080 (ratio 1):
    // element is wider than the picture, so height-bound with side bars.
    const box = computePictureBox(0, 0, 1080, 1080, 720, 1280)!;
    expect(box.height).toBe(1080);
    expect(box.width).toBeCloseTo(1080 * (720 / 1280), 5); // 607.5
    expect(box.height).toBe(1080);
    expect(box.left).toBeCloseTo((1080 - box.width) / 2, 5);
    expect(box.top).toBe(0);
  });

  it("offsets the picture by the video element's viewport position", () => {
    const box = computePictureBox(100, 50, 1928, 1208, 1928, 1208)!;
    expect(box.left).toBe(100);
    expect(box.top).toBe(50);
  });
});
