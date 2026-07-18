/**
 * Picture-box overlay wrapper.
 *
 * Why this exists: every overlay (face box, pose gizmo, model-input frame) is
 * positioned as a `%` of its parent. For `%` coordinates to match the rendered
 * video picture, the parent's box must equal the picture rectangle — the area
 * the video actually paints after `object-fit: contain` letterboxes it inside
 * the `<video>` element. `.video-shell` only equals that rectangle when its own
 * aspect ratio matches the video's; when a height cap (or any other sizing)
 * breaks that match, the picture letterboxes and `%`-positioned overlays drift
 * off the face.
 *
 * `computePictureBox` derives the picture rectangle from the video's bounding
 * rect and intrinsic ratio. `PictureBoxTracker` keeps an overlay wrapper sized
 * to that rectangle on every layout change, so `%`-positioned children track the
 * picture regardless of how the shell around it is sized.
 */

/** A pixel rectangle relative to the viewport (matches DOMRect layout fields). */
export interface PictureRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Compute the rendered picture rectangle for a `<video>` using `object-fit:
 * contain`. The video element's box may be wider/taller than the picture;
 * `contain` centers the picture and bars the remainder. Returns `null` until
 * intrinsic dimensions are known (`videoWidth`/`videoHeight` > 0).
 *
 * Pure: given the video's bounding rect and intrinsic ratio this is fully
 * determined, so it is unit-testable without a DOM.
 */
export function computePictureBox(
  videoLeft: number,
  videoTop: number,
  videoWidth: number,
  videoHeight: number,
  intrinsicWidth: number,
  intrinsicHeight: number,
): PictureRect | null {
  if (intrinsicWidth <= 0 || intrinsicHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) {
    return null;
  }
  const intrinsicRatio = intrinsicWidth / intrinsicHeight;
  const boxRatio = videoWidth / videoHeight;
  let width: number;
  let height: number;
  if (boxRatio > intrinsicRatio) {
    // Element is wider than the picture: pillarbox (bars on the sides).
    height = videoHeight;
    width = height * intrinsicRatio;
  } else {
    // Element is taller than the picture: letterbox (bars top/bottom).
    width = videoWidth;
    height = width / intrinsicRatio;
  }
  return {
    left: videoLeft + (videoWidth - width) / 2,
    top: videoTop + (videoHeight - height) / 2,
    width,
    height,
  };
}

/**
 * Tracks the rendered picture rectangle of a `<video>` and applies it (as px
 * insets) to an overlay wrapper element, so `%`-positioned children of the
 * wrapper always align with the picture. Observes both the video (intrinsic
 * dims arriving via metadata) and the shell (layout-driven size changes), since
 * either can change the picture rectangle independently.
 *
 * Call `disconnect()` on route switch — the overlay wrapper is rebuilt each
 * load, so a stale observer would write to a detached node.
 */
export class PictureBoxTracker {
  private readonly video: HTMLVideoElement;
  private readonly wrapper: HTMLElement;
  // The shell is the video's parent (`.video-shell`) — the same element the
  // wrapper sits in. Captured once so apply() resolves the picture rect
  // shell-relative without depending on the wrapper's offsetParent, which a
  // future CSS change (a positioned ancestor inserted between them, or
  // .video-shell losing position: relative) could silently change.
  private readonly shell: HTMLElement | null;
  private readonly observer: ResizeObserver;
  private connected = false;

  constructor(video: HTMLVideoElement, wrapper: HTMLElement) {
    this.video = video;
    this.wrapper = wrapper;
    this.shell = video.parentElement;
    this.observer = new ResizeObserver(() => this.apply());
  }

  /** Begin observing. Idempotent. */
  observe(): void {
    if (this.connected) return;
    this.connected = true;
    this.observer.observe(this.video);
    // The shell drives the video's layout box; observe it too so viewport
    // changes (docked DevTools, resize) update the wrapper even when the
    // video element's own size is stable relative to its parent.
    if (this.shell) this.observer.observe(this.shell);
    if (this.video.readyState >= 1) this.apply();
    else this.video.addEventListener("loadedmetadata", this.apply, { once: true });
  }

  /** Stop observing and release listeners. Safe to call multiple times. */
  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.observer.disconnect();
    this.video.removeEventListener("loadedmetadata", this.apply);
  }

  private readonly apply = (): void => {
    // Resolve the picture rect shell-relative: the video and the wrapper are
    // both children of .video-shell (this.shell), so subtracting the shell's
    // viewport rect from the video's gives the video's offset within it.
    // computePictureBox then carves the letterboxed picture out of that and
    // we get a shell-relative rectangle the wrapper can use directly. We read
    // the shell from the constructor (the video's parent) rather than the
    // wrapper's offsetParent so the math does not depend on the wrapper's
    // positioned-ancestor chain.
    if (!this.shell) return;
    const origin = this.shell.getBoundingClientRect();
    const rect = this.video.getBoundingClientRect();
    const box = computePictureBox(
      rect.left - origin.left,
      rect.top - origin.top,
      rect.width,
      rect.height,
      this.video.videoWidth,
      this.video.videoHeight,
    );
    if (!box) return;
    const { style } = this.wrapper;
    style.left = `${box.left}px`;
    style.top = `${box.top}px`;
    style.width = `${box.width}px`;
    style.height = `${box.height}px`;
  };
}
