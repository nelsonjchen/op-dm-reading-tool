declare module "mux.js" {
  interface TransmuxedSegment {
    initSegment: Uint8Array;
    data: Uint8Array;
  }

  class Transmuxer {
    constructor(options?: Record<string, unknown>);
    on(event: "data", callback: (segment: TransmuxedSegment) => void): void;
    push(bytes: Uint8Array): void;
    flush(): void;
  }

  const muxjs: {
    mp4: {
      Transmuxer: typeof Transmuxer;
    };
  };

  export default muxjs;
}
