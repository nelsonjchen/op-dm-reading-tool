import { describe, expect, it } from "vitest";
import { parseRouteInput, segmentFromUrl } from "./routes";

describe("route parsing", () => {
  it("accepts route names", () => {
    expect(parseRouteInput("5beb9b58bd12b691|0000010a--a51155e496")).toMatchObject({
      routeName: "5beb9b58bd12b691|0000010a--a51155e496",
      dongleId: "5beb9b58bd12b691",
      routeId: "0000010a--a51155e496",
    });
  });

  it("accepts comma Connect URLs with clip times", () => {
    expect(parseRouteInput("https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496/90/105")).toMatchObject({
      routeName: "5beb9b58bd12b691|0000010a--a51155e496",
      source: "connect-url",
    });
  });

  it("extracts segment numbers from signed log URLs", () => {
    expect(segmentFromUrl("https://example.test/dongle/route/12/qlog.zst?sig=abc")).toBe(12);
    expect(segmentFromUrl("https://example.test/dongle/route/7/rlog.bz2")).toBe(7);
    expect(segmentFromUrl("https://example.test/dongle/route/1/qcamera.ts?sig=abc")).toBe(1);
  });
});
