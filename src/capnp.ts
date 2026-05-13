import { CALIBRATION_STATUS_NAMES, LIVE_CALIBRATION_UNION_TAG } from "./constants";

export interface SegmentData {
  bytes: Uint8Array;
  offset: number;
  lengthWords: number;
}

export interface CalibrationMessage {
  logMonoTime: bigint;
  status: number;
  statusName: string;
  calPerc: number;
  validBlocks: number;
  rpyCalib: number[];
  rpyCalibSpread: number[];
  wideFromDeviceEuler: number[];
  height: number[];
}

interface StructRef {
  segment: SegmentData;
  dataOffset: number;
  pointerOffset: number;
  dataWords: number;
  pointerCount: number;
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
const LIVE_CALIBRATION_STATUS_BYTE_OFFSET = 2;
const LIVE_CALIBRATION_CAL_PERC_BYTE_OFFSET = 1;
const LIVE_CALIBRATION_VALID_BLOCKS_BYTE_OFFSET = 8;

const LIVE_CALIBRATION_POINTER_FIELDS = {
  rpyCalib: 4,
  rpyCalibSpread: 5,
  wideFromDeviceEuler: 6,
  height: 7,
} as const;

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

export function findFirstCalibrationMessage(
  bytes: Uint8Array,
  predicate: (message: CalibrationMessage) => boolean = (message) => message.status === 1 && message.rpyCalib.length === 3,
): CalibrationMessage | null {
  return findCalibrationMessages(bytes, predicate)[0] ?? null;
}

export function findCalibrationMessages(
  bytes: Uint8Array,
  predicate: (message: CalibrationMessage) => boolean = (message) => message.status === 1 && message.rpyCalib.length === 3,
): CalibrationMessage[] {
  const messages: CalibrationMessage[] = [];
  for (const segments of readMessages(bytes)) {
    const msg = readLiveCalibrationMessage(segments);
    if (msg && predicate(msg)) {
      messages.push(msg);
    }
  }
  return messages;
}

export function readLiveCalibrationMessage(segments: SegmentData[]): CalibrationMessage | null {
  if (segments.length === 0) return null;
  const root = readStructPointer(segments, 0, segments[0].offset);
  if (!root) return null;

  const unionTag = getUint16(root, EVENT_UNION_TAG_BYTE_OFFSET);
  if (unionTag !== LIVE_CALIBRATION_UNION_TAG) return null;

  const liveCalibration = readStructPointer(segments, root.segmentIndex, pointerFieldOffset(root, EVENT_POINTER_FIELD_0));
  if (!liveCalibration) return null;

  const status = getUint16(liveCalibration, LIVE_CALIBRATION_STATUS_BYTE_OFFSET);
  return {
    logMonoTime: getBigUint64(root, 0),
    status,
    statusName: CALIBRATION_STATUS_NAMES[status] ?? `unknown (${status})`,
    calPerc: getInt8(liveCalibration, LIVE_CALIBRATION_CAL_PERC_BYTE_OFFSET),
    validBlocks: getInt32(liveCalibration, LIVE_CALIBRATION_VALID_BLOCKS_BYTE_OFFSET),
    rpyCalib: readFloat32List(liveCalibration, LIVE_CALIBRATION_POINTER_FIELDS.rpyCalib),
    rpyCalibSpread: readFloat32List(liveCalibration, LIVE_CALIBRATION_POINTER_FIELDS.rpyCalibSpread),
    wideFromDeviceEuler: readFloat32List(liveCalibration, LIVE_CALIBRATION_POINTER_FIELDS.wideFromDeviceEuler),
    height: readFloat32List(liveCalibration, LIVE_CALIBRATION_POINTER_FIELDS.height),
  };
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

function getInt32(ref: StructRef, relativeOffset: number): number {
  const view = new DataView(ref.segment.bytes.buffer, ref.segment.bytes.byteOffset, ref.segment.bytes.byteLength);
  return view.getInt32(ref.dataOffset + relativeOffset, true);
}

function getInt8(ref: StructRef, relativeOffset: number): number {
  const view = new DataView(ref.segment.bytes.buffer, ref.segment.bytes.byteOffset, ref.segment.bytes.byteLength);
  return view.getInt8(ref.dataOffset + relativeOffset);
}

function signed30(value: number): number {
  return value & 0x20000000 ? value - 0x40000000 : value;
}
