import { describe, expect, it, vi } from "vitest";
import { setAccessToken } from "./auth";
import { loadDriverDebugRoute } from "./debugger";

const modernRoute = process.env.COMMA_TEST_ROUTE;
const commaJwt = process.env.COMMA_JWT;
const liveTest = modernRoute && commaJwt ? it : it.skip;

describe("Driver Monitoring live routes", () => {
  liveTest("decodes modern policy state, driver model state, and byte indexes", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    setAccessToken(commaJwt!);

    const result = await loadDriverDebugRoute(modernRoute!);
    expect(result.monitoring.length).toBeGreaterThan(0);
    expect(result.monitoring[0].schema).toBe("modern");
    expect(result.monitoring[0].activePolicy).toBe("vision");
    expect(result.models[0].left.faceOrientation).toHaveLength(3);
    expect(result.videoSources[0].frames.length).toBeGreaterThan(1000);
    expect(result.videoSources[0].frames[0].byteOffset).toBe(0);
    expect(result.videoSources[0].frames.at(-1)?.routeSeconds).toBeGreaterThan(55);
    expect(result.videoSources[0].frames[100].routeSeconds).toBeGreaterThan(4);
    expect(result.videoSources[0].frames[100].routeSeconds).toBeLessThan(6);
    expect(result.videoSources[0].frames[0].keyframe).toBe(true);
    expect(result.videoSources[0].frames[100].encodeIndex).toBe(100);
    vi.unstubAllGlobals();
  }, 60_000);

  liveTest("loads full-rate modern DM telemetry from the rlog", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    setAccessToken(commaJwt!);

    const result = await loadDriverDebugRoute(modernRoute!, () => {}, { highResolutionTelemetry: true });
    expect(result.logSource).toBe("rlogs");
    expect(result.telemetryHz).toBeGreaterThan(15);
    expect(result.monitoring[0].schema).toBe("modern");
    vi.unstubAllGlobals();
  }, 180_000);

  it("normalizes the legacy flat Driver Monitoring state", async () => {
    const result = await loadDriverDebugRoute(
      "https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496/0/5",
    );
    expect(result.monitoring.length).toBeGreaterThan(0);
    expect(result.monitoring[0].schema).toBe("legacy");
    expect(result.models[0].left.facePosition).toHaveLength(2);
    expect(result.videoSources[0].frames[0].keyframe).toBe(true);
  }, 60_000);
});
