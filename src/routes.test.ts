import { describe, expect, it } from "vitest";
import { logSourceLabel, orderedLogUrls, parseRouteInput, segmentFromUrl } from "./routes";
import { buildAuthCallbackCleanUrl, buildRouteShareUrl, routeInputFromUrl } from "./routeInput";

describe("route parsing", () => {
  it("accepts route names", () => {
    expect(parseRouteInput("5beb9b58bd12b691|0000010a--a51155e496")).toMatchObject({
      routeName: "5beb9b58bd12b691|0000010a--a51155e496",
      dongleId: "5beb9b58bd12b691",
      routeId: "0000010a--a51155e496",
    });
  });

  it("accepts comma Connect URLs", () => {
    expect(parseRouteInput("https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496")).toMatchObject({
      routeName: "5beb9b58bd12b691|0000010a--a51155e496",
      source: "connect-url",
    });
  });

  it("preserves clip times from comma Connect URLs", () => {
    expect(parseRouteInput("https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496/90/105")).toMatchObject({
      routeName: "5beb9b58bd12b691|0000010a--a51155e496",
      source: "connect-url",
      startSeconds: 90,
      endSeconds: 105,
    });
  });

  it("extracts segment numbers from signed log URLs", () => {
    expect(segmentFromUrl("https://example.test/dongle/route/12/qlog.zst?sig=abc")).toBe(12);
    expect(segmentFromUrl("https://example.test/dongle/route/7/rlog.bz2")).toBe(7);
    expect(segmentFromUrl("https://example.test/dongle/route/1/qcamera.ts?sig=abc")).toBe(1);
  });

  it("prefers qlogs by default and rlogs for high-resolution telemetry", () => {
    const files = {
      qlogs: ["https://example.test/dongle/route/0/qlog.zst"],
      logs: ["https://example.test/dongle/route/0/rlog.zst"],
    };
    expect(logSourceLabel(files)).toBe("qlogs");
    expect(orderedLogUrls(files)[0]).toContain("qlog.zst");
    expect(logSourceLabel(files, true)).toBe("rlogs");
    expect(orderedLogUrls(files, true)[0]).toContain("rlog.zst");
  });

  it("falls back to qlogs when high-resolution telemetry is unavailable", () => {
    const files = { qlogs: ["https://example.test/dongle/route/0/qlog.zst"] };
    expect(logSourceLabel(files, true)).toBe("qlogs");
    expect(orderedLogUrls(files, true)[0]).toContain("qlog.zst");
  });

  it("builds share URLs on the configured app base path", () => {
    expect(buildRouteShareUrl("https://example.test", "/op-dm-reading-tool/", "5beb9b58bd12b691|0000010a--a51155e496")).toBe(
      "https://example.test/op-dm-reading-tool/?route=5beb9b58bd12b691%7C0000010a--a51155e496",
    );
  });

  it("preserves Connect clip URLs in share URLs", () => {
    const shareUrl = buildRouteShareUrl(
      "https://example.test",
      "/",
      "https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496/90/105",
    );

    expect(routeInputFromUrl(shareUrl)).toBe("https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496/90/105");
  });

  it("ignores empty and invalid route query params", () => {
    expect(routeInputFromUrl("https://example.test/?route=%20")).toBeNull();
    expect(routeInputFromUrl("https://example.test/?route=not-a-route")).toBeNull();
  });

  it("preserves route params when cleaning OAuth callback URLs", () => {
    expect(
      buildAuthCallbackCleanUrl(
        "https://example.test/op-dm-reading-tool/?code=abc&provider=g&route=5beb9b58bd12b691%7C0000010a--a51155e496",
        "/op-dm-reading-tool/",
      ),
    ).toBe("https://example.test/op-dm-reading-tool/?route=5beb9b58bd12b691%7C0000010a--a51155e496");
  });
});
