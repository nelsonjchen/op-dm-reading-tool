import { createFile } from "mp4box";
import type { DriverVideoFrameIndex } from "./dm";

const MAX_RANGE_BYTES = 512 * 1024;
// Some qlog frame indexes stop just before the final NAL reaches camera-file
// EOF. The bounded tail request completes that last frame without fetching the file.
const FINAL_FRAME_OVERFETCH_BYTES = 64 * 1024;
const BUFFER_AHEAD_SECONDS = 20;
const SEEK_BUFFER_CUSHION_SECONDS = 1;
const VIDEO_DEMAND_EVENT = "driver-video-demand";
const HEVC_CODEC = "hvc1.1.6.L153.B0";
const TIMESCALE = 10_240;

export interface HevcSupport {
  mediaSource: boolean;
  htmlVideo: boolean;
  supported: boolean;
  codec: string;
  // True when playback uses ManagedMediaSource (iOS 17.1+) rather than the
  // standard MediaSource. When true, the <video> element must already carry
  // the `managed` attribute and have remote playback disabled before its
  // source is assigned (see attachMediaSource).
  managed: boolean;
}

export interface PlannedVideoRange {
  start: number;
  end: number;
  frames: DriverVideoFrameIndex[];
}

// The constructor shape shared by MediaSource and ManagedMediaSource, so a
// single variable can hold whichever the platform exposes.
type MediaSourceConstructor = {
  prototype: MediaSource;
  new (): MediaSource;
  isTypeSupported(type: string): boolean;
};

// Selects the MediaSource implementation to use. Prefers the standard
// `MediaSource` (everywhere it exists — desktop browsers), and falls back to
// `ManagedMediaSource`, the only variant iOS exposes (from 17.1 on). Returns
// null on platforms with no MSE at all (e.g. iOS < 17.1).
export function selectMediaSourceCtor(): { ctor: MediaSourceConstructor; managed: boolean } | null {
  if (typeof MediaSource !== "undefined") return { ctor: MediaSource, managed: false };
  if (typeof ManagedMediaSource !== "undefined") return { ctor: ManagedMediaSource, managed: true };
  return null;
}

export function detectHevcSupport(): HevcSupport {
  const video = document.createElement("video");
  const mime = `video/mp4; codecs="${HEVC_CODEC}"`;
  const selection = selectMediaSourceCtor();
  const mediaSource = selection !== null && selection.ctor.isTypeSupported(mime);
  const htmlVideo = video.canPlayType(mime) !== "";
  return {
    mediaSource,
    htmlVideo,
    supported: mediaSource && htmlVideo,
    codec: HEVC_CODEC,
    managed: selection?.managed ?? false,
  };
}

export function framesForClip(frames: DriverVideoFrameIndex[], startSeconds: number, endSeconds: number): DriverVideoFrameIndex[] {
  if (frames.length === 0) return [];
  const presentation = [...frames].sort((a, b) => a.routeSeconds - b.routeSeconds);
  if (presentation.at(-1)!.routeSeconds < startSeconds || presentation[0].routeSeconds >= endSeconds) return [];
  const targetIndex = presentation.findIndex((frame) => frame.routeSeconds >= startSeconds);
  const firstTarget = targetIndex < 0 ? presentation.length - 1 : targetIndex;
  let keyframe = firstTarget;
  while (keyframe > 0 && !presentation[keyframe].keyframe) keyframe -= 1;
  const selectedPresentation = presentation.filter((frame, index) => index >= keyframe && frame.routeSeconds < endSeconds);
  const selected = new Set(selectedPresentation.map((frame) => `${frame.segment}:${frame.presentationIndex}`));
  return frames
    .filter((frame) => selected.has(`${frame.segment}:${frame.presentationIndex}`))
    .sort((a, b) => a.encodeIndex - b.encodeIndex);
}

export function planVideoRanges(frames: DriverVideoFrameIndex[], maxBytes = MAX_RANGE_BYTES): PlannedVideoRange[] {
  const ranges: PlannedVideoRange[] = [];
  for (const frame of frames) {
    const previous = ranges.at(-1);
    const frameEnd = frame.byteOffset + frame.byteLength - 1;
    const contiguous = previous && frame.byteOffset === previous.end + 1;
    const exceedsTarget = previous && frameEnd - previous.start + 1 > maxBytes;
    if (previous && contiguous && (!exceedsTarget || !frame.keyframe)) {
      previous.end = frameEnd;
      previous.frames.push(frame);
    } else {
      // qcamera frame byte offsets can precede the next Annex-B start code. Let
      // the prior fetch overlap one complete keyframe so its final NAL is not
      // truncated when a memory-sized range is split.
      if (previous && contiguous) previous.end = frameEnd;
      ranges.push({ start: frame.byteOffset, end: frameEnd, frames: [frame] });
    }
  }
  return ranges;
}

export class DriverVideoPlayer {
  private abortController: AbortController | null = null;
  private mediaSource: MediaSource | ManagedMediaSource | null = null;
  private objectUrl: string | null = null;
  private pendingSeekTime: number | null = null;
  private resumeAfterSeek = false;
  private playbackRequested = false;
  private playAttempt: Promise<void> | null = null;
  private scheduledPlay: number | null = null;
  private playbackGeneration = 0;
  playbackRouteStart = 0;

  // managed=true selects the ManagedMediaSource (iOS 17.1+) path; see HevcSupport.managed.
  constructor(private readonly video: HTMLVideoElement, private readonly managed: boolean) {}

  get isPlaybackRequested(): boolean {
    return this.playbackRequested;
  }

  togglePlayback(): boolean {
    if (this.playbackRequested) this.pause();
    else this.play();
    return this.playbackRequested;
  }

  play(): void {
    this.playbackRequested = true;
    if (this.pendingSeekTime !== null) {
      this.resumeAfterSeek = true;
      if (isBuffered(this.video, this.pendingSeekTime, SEEK_BUFFER_CUSHION_SECONDS)) {
        this.applyPendingSeek();
        return;
      }
      this.video.dispatchEvent(new Event(VIDEO_DEMAND_EVENT));
      return;
    }
    this.requestPlayback();
  }

  pause(): void {
    this.playbackRequested = false;
    this.resumeAfterSeek = false;
    this.suspendPlayback();
  }

  seek(routeSeconds: number): void {
    const target = Math.max(0, routeSeconds - this.playbackRouteStart);
    if (isBuffered(this.video, target, SEEK_BUFFER_CUSHION_SECONDS)) {
      const shouldResume = this.playbackRequested;
      this.pendingSeekTime = null;
      this.resumeAfterSeek = false;
      this.video.currentTime = target;
      if (shouldResume) this.requestPlayback();
      return;
    }
    const shouldResume = this.playbackRequested || !this.video.paused;
    this.suspendPlayback();
    this.resumeAfterSeek = shouldResume;
    this.pendingSeekTime = target;
    this.video.dispatchEvent(new Event(VIDEO_DEMAND_EVENT));
  }

  async load(
    segmentSources: Array<{ url: string; frames: DriverVideoFrameIndex[] }>,
    startSeconds: number,
    endSeconds: number,
    onProgress: (message: string, fraction: number) => void,
    onBackgroundError: (error: unknown) => void = () => {},
  ): Promise<void> {
    this.destroy();
    this.abortController = new AbortController();
    const selected = segmentSources.map((source) => ({
      ...source,
      frames: framesForClip(source.frames, startSeconds, endSeconds),
    })).filter((source) => source.frames.length > 0);
    if (selected.length === 0) throw new Error("No indexed driver-camera frames overlap this clip.");
    this.playbackRouteStart = Math.min(...selected.flatMap((source) => source.frames.map((frame) => frame.routeSeconds)));
    this.pendingSeekTime = Math.max(0, startSeconds - this.playbackRouteStart);
    const sourcePlans = selected.map((source) => {
      const allSourceFrames = segmentSources.find((candidate) => candidate.url === source.url)?.frames ?? source.frames;
      const firstSelected = source.frames[0];
      const lastSelected = source.frames.at(-1)!;
      const lookbehind = allSourceFrames.find((frame) => frame.encodeIndex === firstSelected.encodeIndex - 1);
      const lookahead = allSourceFrames.find((frame) => frame.encodeIndex === lastSelected.encodeIndex + 1);
      const downloadFrames = [
        ...(lookbehind ? [lookbehind] : []),
        ...source.frames,
        ...(lookahead ? [lookahead] : []),
      ];
      const ranges = planVideoRanges(downloadFrames);
      return { source, ranges, overfetchFinalRange: !lookahead };
    });
    const signal = this.abortController.signal;
    const mediaSource = this.managed ? new ManagedMediaSource() : new MediaSource();
    this.mediaSource = mediaSource;
    this.objectUrl = URL.createObjectURL(mediaSource);
    attachMediaSource(this.video, this.objectUrl, this.managed);
    await waitForMediaSourceOpen(mediaSource, signal);
    mediaSource.duration = Math.max(0.1, endSeconds - this.playbackRouteStart);
    const sourceBuffer = mediaSource.addSourceBuffer(`video/mp4; codecs="${HEVC_CODEC}"`);

    let firstFragmentSettled = false;
    let resolveFirstFragment!: () => void;
    let rejectFirstFragment!: (error: unknown) => void;
    const firstFragment = new Promise<void>((resolve, reject) => {
      resolveFirstFragment = resolve;
      rejectFirstFragment = reject;
    });
    void this.pumpFragments(sourcePlans, sourceBuffer, onProgress, signal, () => {
      if (firstFragmentSettled) return;
      firstFragmentSettled = true;
      resolveFirstFragment();
    }).catch((error) => {
      if (!firstFragmentSettled) {
        firstFragmentSettled = true;
        rejectFirstFragment(error);
      } else if (!signal.aborted) onBackgroundError(error);
    });
    await firstFragment;
  }

  private async pumpFragments(
    sourcePlans: Array<{
      source: { url: string; frames: DriverVideoFrameIndex[] };
      ranges: PlannedVideoRange[];
      overfetchFinalRange: boolean;
    }>,
    sourceBuffer: SourceBuffer,
    onProgress: (message: string, fraction: number) => void,
    signal: AbortSignal,
    onFirstFragment: () => void,
  ): Promise<void> {
    const totalRanges = sourcePlans.reduce((sum, plan) => sum + plan.ranges.length, 0);
    const selectedFrames = new Set(sourcePlans.flatMap(({ source }) => source.frames.map(frameKey)));
    const appendedFrames = new Set<string>();
    let completedRanges = 0;
    let trackId: number | null = null;
    let decodeTime = 0;
    let sequence = 1;
    let initialized = false;

    for (const { source, ranges, overfetchFinalRange } of sourcePlans) {
      for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
        const range = ranges[rangeIndex];
        const wantedFrames = range.frames.filter((frame) => selectedFrames.has(frameKey(frame)) && !appendedFrames.has(frameKey(frame)));
        if (wantedFrames.length > 0 && initialized) {
          const fragmentStart = wantedFrames[0].routeSeconds - this.playbackRouteStart;
          await waitForPlaybackDemand(
            this.video,
            fragmentStart,
            signal,
            () => (this.pendingSeekTime ?? this.video.currentTime) + BUFFER_AHEAD_SECONDS,
          );
        }
        const isFinalSourceRange = overfetchFinalRange && rangeIndex === ranges.length - 1;
        const bytes = await fetchRange(
          source.url,
          range.start,
          range.end + (isFinalSourceRange ? FINAL_FRAME_OVERFETCH_BYTES : 0),
          signal,
          isFinalSourceRange,
        );
        completedRanges += 1;
        onProgress(`Buffering driver video (${completedRanges}/${totalRanges} chunks)`, completedRanges / totalRanges);
        const streamNalus = splitAnnexB(bytes);
        if (!initialized) {
          let configNalus = streamNalus;
          if (!hasHevcConfig(configNalus)) {
            configNalus = splitAnnexB(await fetchRange(source.url, 0, 256 * 1024 - 1, signal));
          }
          const config = buildHevcConfig(configNalus);
          const size = readHevcDimensions(config.sps);
          const mp4 = createFile();
          mp4.init({ brands: ["iso6", "isom", "mp41"], timescale: TIMESCALE, duration: 0 });
          trackId = mp4.addTrack({
            type: "hvc1",
            width: size.width,
            height: size.height,
            timescale: TIMESCALE,
            duration: 0,
            media_duration: 0,
            hevcDecoderConfigRecord: config.record.buffer as ArrayBuffer,
          });
          if (!trackId) throw new Error("Could not create the HEVC MP4 track.");
          reorderMoovForCompatibility(mp4);
          const stream = mp4.getBuffer();
          const init = new Uint8Array(stream.buffer.slice(0, stream.byteLength));
          patchHvcCReservedBits(init);
          await appendToSourceBuffer(this.video, sourceBuffer, init, signal);
          initialized = true;
        }
        const accessUnits = groupAccessUnits(streamNalus);
        if (accessUnits.length < range.frames.length) {
          throw new Error(`HEVC chunk ended after ${accessUnits.length}/${range.frames.length} indexed frames.`);
        }
        const samples = range.frames.flatMap((frame, index) => {
          const key = frameKey(frame);
          if (!selectedFrames.has(key) || appendedFrames.has(key)) return [];
          appendedFrames.add(key);
          const unit = accessUnits[index];
          return [{
            data: annexBToLengthPrefixed(unit.nalus),
            duration: Math.max(1, Math.round(frame.durationMs * TIMESCALE / 1_000)),
            keyframe: unit.keyframe,
            compositionOffset: Math.round(frame.compositionTimeOffsetMs * TIMESCALE / 1_000),
          }];
        });
        if (samples.length > 0 && trackId !== null) {
          const fragment = makeFragment(trackId, sequence, decodeTime, samples);
          sequence += 1;
          decodeTime += samples.reduce((sum, sample) => sum + sample.duration, 0);
          await appendToSourceBuffer(this.video, sourceBuffer, fragment, signal);
          this.applyPendingSeek();
          onFirstFragment();
        }
        await yieldToBrowser();
      }
    }
    if (this.mediaSource?.readyState === "open" && !sourceBuffer.updating) this.mediaSource.endOfStream();
  }

  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.pause();
    // Clear the attach: src attribute, <source> children, and the managed-path
    // remote-playback gate. See detachMediaSource / attachMediaSource.
    detachMediaSource(this.video, this.managed);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.mediaSource = null;
    this.pendingSeekTime = null;
    this.resumeAfterSeek = false;
  }

  private applyPendingSeek(): void {
    if (this.pendingSeekTime === null || !isBuffered(this.video, this.pendingSeekTime, SEEK_BUFFER_CUSHION_SECONDS)) return;
    const target = this.pendingSeekTime;
    const shouldResume = this.resumeAfterSeek;
    this.pendingSeekTime = null;
    this.resumeAfterSeek = false;
    this.video.currentTime = target;
    if (shouldResume && this.playbackRequested) this.requestPlayback();
  }

  private requestPlayback(): void {
    if (
      !this.playbackRequested
      || this.pendingSeekTime !== null
      || this.playAttempt
      || this.scheduledPlay !== null
      || !this.video.paused
      || this.video.error
    ) return;
    const generation = this.playbackGeneration;
    // Coalesce back-to-back UI commands before touching the media element.
    this.scheduledPlay = window.setTimeout(() => {
      this.scheduledPlay = null;
      if (generation === this.playbackGeneration) this.startPlayback();
    }, 0);
  }

  private startPlayback(): void {
    if (!this.playbackRequested || this.playAttempt || !this.video.paused || this.video.error) return;
    const generation = this.playbackGeneration;
    let attempt: Promise<void>;
    try {
      attempt = this.video.play();
    } catch (error) {
      console.error("Driver video playback failed.", error);
      return;
    }
    this.playAttempt = attempt;
    void attempt.then(
      () => this.finishPlayAttempt(attempt, generation, true),
      (error: unknown) => {
        const interrupted = error instanceof DOMException && error.name === "AbortError";
        if (!interrupted) console.error("Driver video playback failed.", error);
        this.finishPlayAttempt(attempt, generation, interrupted);
      },
    );
  }

  private finishPlayAttempt(attempt: Promise<void>, generation: number, mayRetry: boolean): void {
    if (generation !== this.playbackGeneration || this.playAttempt !== attempt) return;
    this.playAttempt = null;
    if (!this.playbackRequested) {
      if (!this.video.paused) this.video.pause();
      return;
    }
    if (mayRetry && this.video.paused && !this.video.error) this.requestPlayback();
  }

  private suspendPlayback(): void {
    this.playbackGeneration += 1;
    this.playAttempt = null;
    if (this.scheduledPlay !== null) window.clearTimeout(this.scheduledPlay);
    this.scheduledPlay = null;
    if (!this.video.paused) this.video.pause();
  }
}

interface Nalu { type: number; data: Uint8Array<ArrayBuffer>; }
interface AccessUnit { nalus: Nalu[]; keyframe: boolean; }

export function splitAnnexB(bytes: Uint8Array): Nalu[] {
  const starts: Array<{ offset: number; size: number }> = [];
  for (let index = 0; index + 3 < bytes.length;) {
    if (bytes[index] === 0 && bytes[index + 1] === 0 && bytes[index + 2] === 0 && bytes[index + 3] === 1) {
      starts.push({ offset: index, size: 4 });
      index += 4;
    } else if (bytes[index] === 0 && bytes[index + 1] === 0 && bytes[index + 2] === 1) {
      starts.push({ offset: index, size: 3 });
      index += 3;
    } else index += 1;
  }
  return starts.flatMap((start, index) => {
    const from = start.offset + start.size;
    const to = starts[index + 1]?.offset ?? bytes.length;
    if (to <= from) return [];
    const data = copyBytes(bytes.subarray(from, to));
    return [{ type: (data[0] >> 1) & 0x3f, data }];
  });
}

function buildHevcConfig(nalus: Nalu[]): { record: Uint8Array<ArrayBuffer>; sps: Uint8Array<ArrayBuffer> } {
  const vps = nalus.find((nalu) => nalu.type === 32)?.data;
  const sps = nalus.find((nalu) => nalu.type === 33)?.data;
  const pps = nalus.find((nalu) => nalu.type === 34)?.data;
  if (!vps || !sps || !pps || sps.length < 15) throw new Error("The first keyframe is missing HEVC VPS/SPS/PPS configuration.");
  const profile = removeEmulationPrevention(sps.slice(2));
  const header = new Uint8Array([
    1, profile[1], ...profile.slice(2, 6), ...profile.slice(6, 12), profile[12],
    0xf0, 0, 0xfc, 0xfd, 0xf8, 0xf8, 0, 0, 0x0f, 3,
  ]);
  return { record: concatBytes(header, hevcArray(32, vps), hevcArray(33, sps), hevcArray(34, pps)), sps };
}

function hasHevcConfig(nalus: Nalu[]): boolean {
  return [32, 33, 34].every((type) => nalus.some((nalu) => nalu.type === type));
}

function groupAccessUnits(nalus: Nalu[]): AccessUnit[] {
  const units: AccessUnit[] = [];
  let current: Nalu[] = [];
  let hasVcl = false;
  for (const nalu of nalus) {
    const isVcl = nalu.type <= 31;
    const firstSlice = isVcl && nalu.data.length > 2 && (nalu.data[2] & 0x80) !== 0;
    if (firstSlice && hasVcl) {
      units.push({ nalus: current, keyframe: current.some((item) => item.type >= 16 && item.type <= 21) });
      current = [];
      hasVcl = false;
    }
    current.push(nalu);
    hasVcl ||= isVcl;
  }
  if (hasVcl) units.push({ nalus: current, keyframe: current.some((item) => item.type >= 16 && item.type <= 21) });
  return units;
}

function hevcArray(type: number, nalu: Uint8Array): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array([0x80 | type, 0, 1, (nalu.length >>> 8) & 0xff, nalu.length & 0xff]);
  return concatBytes(header, nalu);
}

function annexBToLengthPrefixed(nalus: Nalu[]): Uint8Array<ArrayBuffer> {
  const sampleNalus = nalus.filter((nalu) => nalu.type !== 32 && nalu.type !== 33 && nalu.type !== 34 && nalu.type !== 35);
  const parts = sampleNalus.flatMap((nalu) => {
    const length = nalu.data.length;
    return [new Uint8Array([(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff]), nalu.data];
  });
  return concatBytes(...parts);
}

function readHevcDimensions(spsNalu: Uint8Array): { width: number; height: number } {
  const rbsp = removeEmulationPrevention(spsNalu.slice(2));
  const bits = new BitReader(rbsp);
  bits.skip(4);
  const maxSubLayersMinus1 = bits.read(3);
  bits.skip(1 + 2 + 1 + 5 + 32 + 48 + 8);
  const profileFlags: boolean[] = [];
  const levelFlags: boolean[] = [];
  for (let index = 0; index < maxSubLayersMinus1; index += 1) {
    profileFlags.push(Boolean(bits.read(1)));
    levelFlags.push(Boolean(bits.read(1)));
  }
  if (maxSubLayersMinus1 > 0) bits.skip((8 - maxSubLayersMinus1) * 2);
  for (let index = 0; index < maxSubLayersMinus1; index += 1) {
    if (profileFlags[index]) bits.skip(88);
    if (levelFlags[index]) bits.skip(8);
  }
  bits.ue();
  const chromaFormat = bits.ue();
  if (chromaFormat === 3) bits.skip(1);
  let width = bits.ue();
  let height = bits.ue();
  if (bits.read(1)) {
    const left = bits.ue(); const right = bits.ue(); const top = bits.ue(); const bottom = bits.ue();
    const subWidth = chromaFormat === 1 || chromaFormat === 2 ? 2 : 1;
    const subHeight = chromaFormat === 1 ? 2 : 1;
    width -= subWidth * (left + right);
    height -= subHeight * (top + bottom);
  }
  if (!width || !height) throw new Error("Could not read HEVC dimensions from SPS.");
  return { width, height };
}

class BitReader {
  private position = 0;
  constructor(private readonly bytes: Uint8Array) {}
  read(count: number): number { let value = 0; for (let index = 0; index < count; index += 1) value = value * 2 + this.readBit(); return value; }
  skip(count: number): void { this.position += count; }
  ue(): number { let zeros = 0; while (this.readBit() === 0 && zeros < 31) zeros += 1; return (2 ** zeros - 1) + (zeros ? this.read(zeros) : 0); }
  private readBit(): number { const value = (this.bytes[this.position >> 3] >> (7 - (this.position & 7))) & 1; this.position += 1; return value; }
}

function removeEmulationPrevention(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const output: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    if (index >= 2 && bytes[index] === 3 && bytes[index - 1] === 0 && bytes[index - 2] === 0) continue;
    output.push(bytes[index]);
  }
  return new Uint8Array(output);
}

function patchHvcCReservedBits(bytes: Uint8Array): void {
  for (let index = 4; index + 18 < bytes.length; index += 1) {
    if (bytes[index] === 0x68 && bytes[index + 1] === 0x76 && bytes[index + 2] === 0x63 && bytes[index + 3] === 0x43) {
      // MP4Box.js 2.4.1 writes min_spatial_segmentation_idc without the six
      // required reserved one bits. VideoToolbox rejects that hvcC record.
      bytes[index + 4 + 13] |= 0xf0;
      return;
    }
  }
}

function reorderMoovForCompatibility(file: ReturnType<typeof createFile>): void {
  const moov = (file as unknown as { moov?: { boxes?: Array<{ type: string }> } }).moov;
  if (!moov?.boxes) return;
  const rank: Record<string, number> = { mvhd: 0, trak: 1, mvex: 2 };
  moov.boxes.sort((a, b) => (rank[a.type] ?? 1) - (rank[b.type] ?? 1));
}

function makeFragment(
  trackId: number,
  sequence: number,
  decodeTime: number,
  samples: Array<{ data: Uint8Array<ArrayBuffer>; duration: number; keyframe: boolean; compositionOffset: number }>,
): Uint8Array<ArrayBuffer> {
  const first = samples[0];
  const defaultFlags = 0x01010000;
  const firstSampleFlags = first.keyframe ? 0x02000000 : defaultFlags;
  const uniformDuration = samples.every((sample) => sample.duration === first.duration);
  const hasCompositionOffset = samples.some((sample) => sample.compositionOffset !== 0);
  const tfhd = fullBox("tfhd", 0, 0x020038, concatBytes(
    uint32(trackId), uint32(first.duration), uint32(first.data.byteLength), uint32(defaultFlags),
  ));
  const tfdt = fullBox("tfdt", 1, 0, uint64(BigInt(decodeTime)));
  const trunFlags = 0x000205 | (uniformDuration ? 0 : 0x000100) | (hasCompositionOffset ? 0x000800 : 0);
  const sampleFields = samples.flatMap((sample) => [
    ...(uniformDuration ? [] : [uint32(sample.duration)]),
    uint32(sample.data.byteLength),
    ...(hasCompositionOffset ? [uint32(sample.compositionOffset)] : []),
  ]);
  const trunPayload = concatBytes(
    uint32(samples.length),
    uint32(0), // patched to moof size + mdat header below
    uint32(firstSampleFlags),
    ...sampleFields,
  );
  let trun = fullBox("trun", samples.some((sample) => sample.compositionOffset < 0) ? 1 : 0, trunFlags, trunPayload);
  const traf = box("traf", concatBytes(tfhd, tfdt, trun));
  let moof = box("moof", concatBytes(fullBox("mfhd", 0, 0, uint32(sequence)), traf));
  const dataOffset = moof.byteLength + 8;
  trunPayload.set(uint32(dataOffset), 4);
  trun = fullBox("trun", samples.some((sample) => sample.compositionOffset < 0) ? 1 : 0, trunFlags, trunPayload);
  moof = box("moof", concatBytes(fullBox("mfhd", 0, 0, uint32(sequence)), box("traf", concatBytes(tfhd, tfdt, trun))));
  return concatBytes(moof, box("mdat", concatBytes(...samples.map((sample) => sample.data))));
}

function frameKey(frame: DriverVideoFrameIndex): string {
  return `${frame.segment}:${frame.presentationIndex}`;
}

// Remove any <source> children from a <video> element. Used both to clear
// stale children before attaching a fresh source and to tear down an
// attachment, so the removal logic has a single home.
function clearSourceChildren(video: HTMLVideoElement): void {
  for (const existing of video.querySelectorAll("source")) existing.remove();
}

// Attach a (Managed)MediaSource object URL to a <video> element.
//
// Standard MediaSource: set `video.src` directly (works everywhere).
//
// ManagedMediaSource (iOS 17.1+): Safari refuses to fire `sourceopen` — and
// therefore never opens the source — unless remote playback is explicitly
// disabled on the element AND the URL is provided via a `<source>` child
// rather than the `src` attribute. This is documented by MDN and is exactly
// what hls.js does on its managed path. Without it the source stays `closed`
// forever and no video bytes are ever fetched.
function attachMediaSource(video: HTMLVideoElement, objectUrl: string, managed: boolean): void {
  if (!managed) {
    video.src = objectUrl;
    video.load();
    return;
  }
  video.disableRemotePlayback = true;
  video.removeAttribute("src");
  clearSourceChildren(video);
  const source = document.createElement("source");
  source.type = "video/mp4";
  source.src = objectUrl;
  video.appendChild(source);
  video.load();
}

// Tear down a (Managed)MediaSource attachment so the element is clean for a
// future attach. Pairs with attachMediaSource: drops the `src` attribute, any
// <source> children, and (on the managed path) the Safari remote-playback gate.
function detachMediaSource(video: HTMLVideoElement, managed: boolean): void {
  video.removeAttribute("src");
  clearSourceChildren(video);
  if (managed) video.disableRemotePlayback = false;
  video.load();
}

function waitForMediaSourceOpen(mediaSource: MediaSource | ManagedMediaSource, signal: AbortSignal): Promise<void> {
  if (mediaSource.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      mediaSource.removeEventListener("sourceopen", onOpen);
      signal.removeEventListener("abort", onAbort);
    };
    const onOpen = () => { cleanup(); resolve(); };
    const onAbort = () => { cleanup(); reject(new DOMException("Video loading aborted", "AbortError")); };
    mediaSource.addEventListener("sourceopen", onOpen, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function appendToSourceBuffer(
  video: HTMLVideoElement,
  sourceBuffer: SourceBuffer,
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      sourceBuffer.removeEventListener("updateend", onUpdateEnd);
      sourceBuffer.removeEventListener("error", onError);
      video.removeEventListener("error", onMediaError);
      signal.removeEventListener("abort", onAbort);
    };
    const onUpdateEnd = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("The browser rejected a remuxed video fragment.")); };
    const onMediaError = () => { cleanup(); reject(describeMediaError(video.error)); };
    const onAbort = () => { cleanup(); reject(new DOMException("Video loading aborted", "AbortError")); };
    sourceBuffer.addEventListener("updateend", onUpdateEnd, { once: true });
    sourceBuffer.addEventListener("error", onError, { once: true });
    video.addEventListener("error", onMediaError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (video.error) {
        onMediaError();
        return;
      }
      sourceBuffer.appendBuffer(bytes);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function describeMediaError(error: MediaError | null): Error {
  const detail = error?.message.trim();
  return new Error(detail ? `Driver video playback failed: ${detail}` : "Driver video playback failed.");
}

async function waitForPlaybackDemand(
  video: HTMLVideoElement,
  fragmentStart: number,
  signal: AbortSignal,
  demandTime: () => number,
): Promise<void> {
  while (fragmentStart > demandTime()) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener("timeupdate", onDemand);
        video.removeEventListener("seeking", onDemand);
        video.removeEventListener("play", onDemand);
        video.removeEventListener("error", onMediaError);
        video.removeEventListener(VIDEO_DEMAND_EVENT, onDemand);
        signal.removeEventListener("abort", onAbort);
      };
      const onDemand = () => { cleanup(); resolve(); };
      const onMediaError = () => { cleanup(); reject(describeMediaError(video.error)); };
      const onAbort = () => { cleanup(); reject(new DOMException("Video loading aborted", "AbortError")); };
      video.addEventListener("timeupdate", onDemand, { once: true });
      video.addEventListener("seeking", onDemand, { once: true });
      video.addEventListener("play", onDemand, { once: true });
      video.addEventListener("error", onMediaError, { once: true });
      video.addEventListener(VIDEO_DEMAND_EVENT, onDemand, { once: true });
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

function isBuffered(video: HTMLVideoElement, time: number, cushionSeconds = 0): boolean {
  const duration = Number.isFinite(video.duration) ? video.duration : time + cushionSeconds;
  const requiredEnd = Math.min(duration, time + cushionSeconds);
  for (let index = 0; index < video.buffered.length; index += 1) {
    if (time >= video.buffered.start(index) && requiredEnd <= video.buffered.end(index) - 0.01) return true;
  }
  return false;
}

function box(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  return concatBytes(uint32(payload.byteLength + 8), new TextEncoder().encode(type), payload);
}

function fullBox(type: string, version: number, flags: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  return box(type, concatBytes(new Uint8Array([version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff]), payload));
}

function uint32(value: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function uint64(value: bigint): Uint8Array<ArrayBuffer> {
  return concatBytes(uint32(Number((value >> 32n) & 0xffffffffn)), uint32(Number(value & 0xffffffffn)));
}

async function fetchRange(
  url: string,
  start: number,
  end: number,
  signal: AbortSignal,
  allowShort = false,
): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
  if (!response.ok) throw new Error(`Could not fetch driver video bytes (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const expected = end - start + 1;
  if (response.status === 200 && bytes.byteLength > start) {
    const fullFileRange = bytes.slice(start, Math.min(end + 1, bytes.byteLength));
    if (!allowShort && fullFileRange.byteLength < expected) {
      throw new Error(`Driver video range was truncated (${fullFileRange.byteLength}/${expected} bytes).`);
    }
    return fullFileRange;
  }
  if (!allowShort && bytes.byteLength < expected) throw new Error(`Driver video range was truncated (${bytes.byteLength}/${expected} bytes).`);
  return bytes.subarray(0, expected);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> { return new Uint8Array(bytes); }
function yieldToBrowser(): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, 0)); }
