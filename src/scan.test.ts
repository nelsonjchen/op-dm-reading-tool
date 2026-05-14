import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalibrationMessage } from "./capnp";
import { findDeviceType } from "./capnp";
import { decompressLog } from "./decompress";
import { scanRouteForInvalidCalibration } from "./scan";

vi.mock("./decompress", () => ({
  decompressLog: vi.fn((bytes: Uint8Array, url: string) => {
    if (url.includes("/1/qlog.zst")) throw new Error("unexpected EOF");
    return bytes;
  }),
}));

vi.mock("./capnp", () => ({
  findDeviceType: vi.fn(() => "mici"),
  findCalibrationMessages: vi.fn(() => [
    {
      logMonoTime: 1n,
      status: 1,
      statusName: "calibrated",
      calPerc: 100,
      validBlocks: 20,
      rpyCalib: [0, 0, 0],
      rpyCalibSpread: [],
      wideFromDeviceEuler: [],
      height: [],
    } satisfies CalibrationMessage,
  ]),
}));

describe("full route scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/files")) {
          return Response.json({
            qlogs: ["https://example.test/route/0/qlog.zst", "https://example.test/route/1/qlog.zst"],
            qcameras: ["https://example.test/route/0/qcamera.ts", "https://example.test/route/1/qcamera.ts"],
          });
        }
        if (url.endsWith("/v1/route/test%7Croute/")) {
          return Response.json({ fullname: "test|route" });
        }
        return new Response(new Uint8Array([1]));
      }),
    );
  });

  it("reports unreadable segments as an incomplete scan instead of throwing", async () => {
    const result = await scanRouteForInvalidCalibration("test|route", () => {});

    expect(result.resultType).toBe("incomplete");
    expect(result.reason).toBe("scan-incomplete");
    expect(result.scannedSegments).toBe(1);
    expect(result.totalSegments).toBe(2);
    expect(result.readFailures).toMatchObject([
      {
        segment: 1,
        message: "unexpected EOF while decompressing; this log segment looks truncated",
      },
    ]);
    expect(result.routeInfo?.deviceType).toBe("mici");
    expect(result.qcameraPreview).toMatchObject({
      logUrl: "https://example.test/route/1/qcamera.ts",
      reason: "unreadable-segment",
      segment: 1,
    });
    expect(findDeviceType).toHaveBeenCalledTimes(1);
    expect(decompressLog).toHaveBeenCalledTimes(2);
  });
});
