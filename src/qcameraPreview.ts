import muxjs from "mux.js";

const TS_PACKET_SIZE = 188;
const RANGE_CHUNK_BYTES = 256 * 1024;
const MAX_PREVIEW_BYTES = 1024 * 1024;
type Bytes = Uint8Array<ArrayBuffer>;

export interface CapturedQcameraFrame {
  dataUrl: string;
  bytesFetched: number;
  width: number;
  height: number;
}

export async function captureFirstQcameraFrame(qcameraUrl: string): Promise<CapturedQcameraFrame> {
  let bytes: Bytes = new Uint8Array(0);

  for (let start = 0; start < MAX_PREVIEW_BYTES; start += RANGE_CHUNK_BYTES) {
    const next = await fetchRange(qcameraUrl, start, Math.min(start + RANGE_CHUNK_BYTES - 1, MAX_PREVIEW_BYTES - 1));
    bytes = concatBytes(bytes, next);

    try {
      const mp4 = transmuxTsToMp4(trimToTransportPackets(bytes));
      return await decodeFirstFrame(mp4, bytes.byteLength);
    } catch (error) {
      if (start + RANGE_CHUNK_BYTES >= MAX_PREVIEW_BYTES) throw error;
    }

    if (next.byteLength < RANGE_CHUNK_BYTES) break;
  }

  throw new Error("Could not decode a qcamera preview frame from the first 1 MiB.");
}

async function fetchRange(url: string, start: number, end: number): Promise<Bytes> {
  const response = await fetch(url, {
    headers: {
      Range: `bytes=${start}-${end}`,
    },
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(`Could not fetch qcamera range (${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function transmuxTsToMp4(tsBytes: Bytes): Bytes {
  if (tsBytes.byteLength < TS_PACKET_SIZE) throw new Error("Not enough qcamera data to transmux.");

  const segments: Bytes[] = [];
  const transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: false });
  transmuxer.on("data", (segment) => {
    segments.push(concatBytes(segment.initSegment, segment.data));
  });
  transmuxer.push(tsBytes);
  transmuxer.flush();

  if (segments.length === 0) throw new Error("No decodable qcamera video segment found.");
  return concatBytes(...segments);
}

async function decodeFirstFrame(mp4Bytes: Bytes, bytesFetched: number): Promise<CapturedQcameraFrame> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const objectUrl = URL.createObjectURL(new Blob([mp4Bytes.buffer], { type: "video/mp4" }));
  try {
    video.src = objectUrl;
    await waitForVideoFrame(video);

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create qcamera canvas context.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.82),
      bytesFetched,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out decoding qcamera preview."));
    }, 6000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("error", onError);
    };

    const onLoadedData = () => {
      if (video.videoWidth === 0 || video.videoHeight === 0) return;
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Browser could not decode qcamera preview."));
    };

    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("error", onError);
    video.load();
  });
}

function trimToTransportPackets(bytes: Bytes): Bytes {
  return copyBytes(bytes.slice(0, bytes.byteLength - (bytes.byteLength % TS_PACKET_SIZE)));
}

function concatBytes(...chunks: Uint8Array[]): Bytes {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function copyBytes(bytes: Uint8Array): Bytes {
  const result = new Uint8Array(bytes.byteLength);
  result.set(bytes);
  return result;
}
