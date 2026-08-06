export interface SegmentData {
  bytes: Uint8Array;
  offset: number;
  lengthWords: number;
}

export type DeviceType = "unknown" | "neo" | "chffrAndroid" | "chffrIos" | "tici" | "pc" | "tizi" | "mici";

export interface StructRef {
  segment: SegmentData;
  segmentIndex: number;
  dataOffset: number;
  pointerOffset: number;
  dataWords: number;
  pointerCount: number;
}

export interface EventEnvelope {
  logMonoTime: bigint;
  unionTag: number;
  payload: StructRef | null;
}

interface ListRef {
  segment: SegmentData;
  offset: number;
  elementSize: number;
  elementCount: number;
}

const WORD_SIZE = 8;
const EVENT_UNION_TAG_BYTE_OFFSET = 8;
const EVENT_POINTER_FIELD_0 = 0;
const INIT_DATA_UNION_TAG = 0;
const DEVICE_STATE_UNION_TAG = 5;
const INIT_DATA_DEVICE_TYPE_BYTE_OFFSET = 0;
const DEVICE_STATE_DEVICE_TYPE_BYTE_OFFSET = 82;
const DEVICE_TYPES: Record<number, DeviceType> = {
  0: "unknown",
  1: "neo",
  2: "chffrAndroid",
  3: "chffrIos",
  4: "tici",
  5: "pc",
  6: "tizi",
  7: "mici",
};

export function* readMessages(bytes: Uint8Array): Generator<SegmentData[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0;

  while (cursor < bytes.byteLength) {
    if (cursor + 4 > bytes.byteLength) return;
    const segmentCount = view.getUint32(cursor, true) + 1;
    cursor += 4;

    const segmentSizes: number[] = [];
    for (let i = 0; i < segmentCount; i += 1) {
      if (cursor + 4 > bytes.byteLength) return;
      segmentSizes.push(view.getUint32(cursor, true));
      cursor += 4;
    }

    if (segmentCount % 2 === 0) {
      cursor += 4;
    }

    const segments: SegmentData[] = [];
    for (const lengthWords of segmentSizes) {
      const byteLength = lengthWords * WORD_SIZE;
      if (cursor + byteLength > bytes.byteLength) return;
      segments.push({ bytes, offset: cursor, lengthWords });
      cursor += byteLength;
    }

    yield segments;
  }
}

export function findDeviceType(bytes: Uint8Array): DeviceType | null {
  try {
    for (const segments of readMessages(bytes)) {
      const deviceType = readDeviceTypeMessage(segments);
      if (deviceType && deviceType !== "unknown") return deviceType;
    }
  } catch {
    // Malformed framing — a bad segment must not abort the route load.
  }
  return null;
}

export function readEventEnvelope(segments: SegmentData[]): EventEnvelope | null {
  if (segments.length === 0) return null;
  const root = readStructPointer(segments, 0, segments[0].offset);
  if (!root) return null;
  let payload: StructRef | null = null;
  try {
    payload = readStructPointer(segments, root.segmentIndex, pointerFieldOffset(root, EVENT_POINTER_FIELD_0));
  } catch {
    // Some unrelated high-volume Event payloads use far pointers. Consumers of
    // this focused decoder can still inspect the tag and skip those messages.
  }
  return {
    logMonoTime: getBigUint64(root, 0),
    unionTag: getUint16(root, EVENT_UNION_TAG_BYTE_OFFSET),
    payload,
  };
}

export function readStructField(ref: StructRef | null, pointerIndex: number): StructRef | null {
  if (!ref || pointerIndex >= ref.pointerCount) return null;
  return readStructPointer([ref.segment], 0, pointerFieldOffset({ ...ref, segmentIndex: 0 }, pointerIndex));
}

export function readFloatList(ref: StructRef | null, pointerIndex: number): number[] {
  return ref ? readFloat32List(ref, pointerIndex) : [];
}

export function readBool(ref: StructRef | null, bitOffset: number): boolean {
  if (!ref) return false;
  const byteOffset = Math.floor(bitOffset / 8);
  return (getUint8(ref, byteOffset) & (1 << (bitOffset % 8))) !== 0;
}

export function readInt8(ref: StructRef | null, slotOffset: number): number {
  return ref ? getInt8(ref, slotOffset) : 0;
}

export function readUint16Slot(ref: StructRef | null, slotOffset: number): number {
  return ref ? getUint16(ref, slotOffset * 2) : 0;
}

export function readUint32(ref: StructRef | null, slotOffset: number): number {
  if (!ref) return 0;
  const view = dataView(ref);
  return view.getUint32(ref.dataOffset + slotOffset * 4, true);
}

export function readInt32Slot(ref: StructRef | null, slotOffset: number): number {
  if (!ref) return 0;
  const view = dataView(ref);
  return view.getInt32(ref.dataOffset + slotOffset * 4, true);
}

export function readUint64Slot(ref: StructRef | null, slotOffset: number): bigint {
  return ref ? getBigUint64(ref, slotOffset * 8) : 0n;
}

export function readFloat32(ref: StructRef | null, slotOffset: number): number {
  if (!ref) return 0;
  const view = dataView(ref);
  return view.getFloat32(ref.dataOffset + slotOffset * 4, true);
}

function readDeviceTypeMessage(segments: SegmentData[]): DeviceType | null {
  if (segments.length === 0) return null;
  const root = readStructPointer(segments, 0, segments[0].offset);
  if (!root) return null;

  const unionTag = getUint16(root, EVENT_UNION_TAG_BYTE_OFFSET);
  if (unionTag !== INIT_DATA_UNION_TAG && unionTag !== DEVICE_STATE_UNION_TAG) return null;

  const eventPayload = readStructPointer(segments, root.segmentIndex, pointerFieldOffset(root, EVENT_POINTER_FIELD_0));
  if (!eventPayload) return null;

  const rawDeviceType =
    unionTag === INIT_DATA_UNION_TAG
      ? getUint16(eventPayload, INIT_DATA_DEVICE_TYPE_BYTE_OFFSET)
      : getUint16(eventPayload, DEVICE_STATE_DEVICE_TYPE_BYTE_OFFSET);
  return DEVICE_TYPES[rawDeviceType] ?? "unknown";
}

function pointerFieldOffset(ref: StructRef & { segmentIndex: number }, pointerIndex: number): number {
  return ref.pointerOffset + pointerIndex * WORD_SIZE;
}

function readStructPointer(
  segments: SegmentData[],
  segmentIndex: number,
  pointerOffset: number,
): (StructRef & { segmentIndex: number }) | null {
  const segment = segments[segmentIndex];
  const raw = readUint64(segment.bytes, pointerOffset);
  if (raw === 0n) return null;
  if ((raw & 0x3n) !== 0n) {
    throw new Error("Unsupported far or non-struct Cap'n Proto pointer in log message.");
  }

  const offsetWords = signed30(Number((raw >> 2n) & 0x3fffffffn));
  const dataWords = Number((raw >> 32n) & 0xffffn);
  const pointerCount = Number((raw >> 48n) & 0xffffn);
  const dataOffset = pointerOffset + WORD_SIZE + offsetWords * WORD_SIZE;
  const pointerSectionOffset = dataOffset + dataWords * WORD_SIZE;

  return {
    segment,
    segmentIndex,
    dataOffset,
    pointerOffset: pointerSectionOffset,
    dataWords,
    pointerCount,
  };
}

function readFloat32List(ref: StructRef & { segmentIndex: number }, pointerIndex: number): number[] {
  if (pointerIndex >= ref.pointerCount) return [];
  const list = readListPointer(ref.segment, pointerFieldOffset(ref, pointerIndex));
  if (!list) return [];
  if (list.elementSize !== 4) {
    throw new Error(`Expected Float32 list, got Cap'n Proto element size ${list.elementSize}.`);
  }

  const view = new DataView(list.segment.bytes.buffer, list.segment.bytes.byteOffset, list.segment.bytes.byteLength);
  const values: number[] = [];
  for (let i = 0; i < list.elementCount; i += 1) {
    values.push(view.getFloat32(list.offset + i * 4, true));
  }
  return values;
}

function readListPointer(segment: SegmentData, pointerOffset: number): ListRef | null {
  const raw = readUint64(segment.bytes, pointerOffset);
  if (raw === 0n) return null;
  if ((raw & 0x3n) !== 1n) {
    throw new Error("Unsupported non-list Cap'n Proto pointer in liveCalibration.");
  }

  const offsetWords = signed30(Number((raw >> 2n) & 0x3fffffffn));
  const elementSize = Number((raw >> 32n) & 0x7n);
  const elementCount = Number((raw >> 35n) & 0x1fffffffn);
  return {
    segment,
    offset: pointerOffset + WORD_SIZE + offsetWords * WORD_SIZE,
    elementSize,
    elementCount,
  };
}

function readUint64(bytes: Uint8Array, byteOffset: number): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getBigUint64(byteOffset, true);
}

function getBigUint64(ref: StructRef, relativeOffset: number): bigint {
  const view = new DataView(ref.segment.bytes.buffer, ref.segment.bytes.byteOffset, ref.segment.bytes.byteLength);
  return view.getBigUint64(ref.dataOffset + relativeOffset, true);
}

function getUint16(ref: StructRef, relativeOffset: number): number {
  const view = new DataView(ref.segment.bytes.buffer, ref.segment.bytes.byteOffset, ref.segment.bytes.byteLength);
  return view.getUint16(ref.dataOffset + relativeOffset, true);
}

function getInt8(ref: StructRef, relativeOffset: number): number {
  const view = new DataView(ref.segment.bytes.buffer, ref.segment.bytes.byteOffset, ref.segment.bytes.byteLength);
  return view.getInt8(ref.dataOffset + relativeOffset);
}

function getUint8(ref: StructRef, relativeOffset: number): number {
  return dataView(ref).getUint8(ref.dataOffset + relativeOffset);
}

function dataView(ref: StructRef): DataView {
  return new DataView(ref.segment.bytes.buffer, ref.segment.bytes.byteOffset, ref.segment.bytes.byteLength);
}

function signed30(value: number): number {
  return value & 0x20000000 ? value - 0x40000000 : value;
}
