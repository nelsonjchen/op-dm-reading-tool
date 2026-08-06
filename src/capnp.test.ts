import { describe, expect, it } from "vitest";
import { findDeviceType } from "./capnp";

describe("Cap'n Proto log parsing", () => {
  it("reads the stable initData deviceType field", () => {
    expect(findDeviceType(minimalInitDataMessage(7))).toBe("mici");
    expect(findDeviceType(minimalInitDataMessage(4))).toBe("tici");
  });

  // findDeviceType is now load-bearing for camera-profile selection: the log
  // bytes are the source of truth for deviceType when the Connect API does not
  // populate it (see debugger.ts). Cover the full device map so a dropped code
  // can't silently flip a route's tici/mici profile.
  it("decodes every known device code", () => {
    const cases: Array<[number, string]> = [
      [1, "neo"],
      [2, "chffrAndroid"],
      [3, "chffrIos"],
      [4, "tici"],
      [5, "pc"],
      [6, "tizi"],
      [7, "mici"],
    ];
    for (const [code, expected] of cases) {
      expect(findDeviceType(minimalInitDataMessage(code))).toBe(expected);
    }
  });

  it("returns null for the unknown code and for bytes with no init data", () => {
    expect(findDeviceType(minimalInitDataMessage(0))).toBeNull();
    expect(findDeviceType(new Uint8Array(0))).toBeNull();
    expect(findDeviceType(new Uint8Array(64))).toBeNull();
  });
});

function minimalInitDataMessage(deviceType: number): Uint8Array {
  const bytes = new Uint8Array(48);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0, true);
  view.setUint32(4, 5, true);

  const segmentOffset = 8;
  writeStructPointer(view, segmentOffset, 0, 2, 1);
  view.setUint16(segmentOffset + 16, 0, true);

  writeStructPointer(view, segmentOffset + 24, 0, 1, 0);
  view.setUint16(segmentOffset + 32, deviceType, true);
  return bytes;
}

function writeStructPointer(view: DataView, offset: number, offsetWords: number, dataWords: number, pointerCount: number): void {
  const raw = (BigInt(offsetWords) << 2n) | (BigInt(dataWords) << 32n) | (BigInt(pointerCount) << 48n);
  view.setBigUint64(offset, raw, true);
}
