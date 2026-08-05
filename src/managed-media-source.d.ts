// Ambient declarations for the Managed Media Source API.
//
// iOS (every browser, since all use WebKit) does not expose the standard
// `MediaSource` global. From iOS 17.1 / Safari 17.1 onward it exposes
// `ManagedMediaSource` instead — Apple's memory-managed MSE variant. A
// `<video>` element must carry the `managed` boolean attribute *before* its
// `src` is assigned to a ManagedMediaSource object URL for the attachment to
// take effect.
//
// TypeScript's bundled DOM lib does not yet ship these declarations, so we
// declare the minimum surface we use here. This file can be deleted once the
// stock `lib.dom.d.ts` provides `ManagedMediaSource` and `HTMLMediaElement.managed`.
//
// Spec: https://developer.mozilla.org/en-US/docs/Web/API/ManagedMediaSource

export {};

declare global {
  // Inherits addSourceBuffer/endOfStream/readyState/sourceopen from MediaSource.
  // We intentionally do not model the startstreaming/endstreaming events; the
  // player does not rely on them for bounded clips.
  interface ManagedMediaSource extends MediaSource {}

  interface HTMLMediaElement {
    managed: boolean;
  }

  // Both `new` and the static `isTypeSupported` are used by the player.
  var ManagedMediaSource: {
    prototype: ManagedMediaSource;
    new (): ManagedMediaSource;
    isTypeSupported(type: string): boolean;
  };
}
