/// <reference types="vite/client" />

interface BuildInfo {
  remoteUrl: string;
  branch: string;
  commit: string;
}

declare const __BUILD_INFO__: BuildInfo;
