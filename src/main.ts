import "./styles.css";
import { checkAccessToken, completeAuthCallback, isSignedIn, setAccessToken, signOut, type AuthCheckResult } from "./auth";
import { loadDriverDebugRoute, type DriverDebugRoute } from "./debugger";
import { sampleAt, selectDriver, type DriverModelData, type DriverMonitoringSample } from "./dm";
import { buildAuthCallbackCleanUrl, buildRouteShareUrl, routeInputFromUrl } from "./routeInput";
import { DriverVideoPlayer, detectHevcSupport } from "./video";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");

app.innerHTML = `
  <section class="tool-shell">
    <header class="masthead">
      <div><p class="eyebrow">openpilot route utility</p><h1>Driver Monitoring debugger</h1></div>
      <span class="privacy-pill">client-side only</span>
    </header>
    <form class="reader-form" id="reader-form">
      <label for="route-input">comma Connect route or clip URL</label>
      <div class="input-row">
        <input id="route-input" autocomplete="off" spellcheck="false" placeholder="https://connect.comma.ai/&lt;dongle&gt;/&lt;route&gt;/&lt;start&gt;/&lt;end&gt;" />
        <button id="load-button" type="submit">Load debugger</button>
        <button id="share-button" class="secondary" type="button" disabled>Share</button>
      </div>
      <p class="form-hint">Bare routes load seconds 0–30. Clip URLs honor their start/end range. Driver video never leaves your browser.</p>
      <label class="quality-option" for="high-resolution-telemetry">
        <input id="high-resolution-telemetry" type="checkbox" />
        <span><strong>High-resolution DM telemetry</strong><small>Prefer 20 Hz rlogs when available. Downloads are substantially larger.</small></span>
      </label>
      <div class="jwt-option" id="auth-panel"></div>
    </form>
    <section class="status-panel" aria-live="polite">
      <div class="progress-track"><div id="progress-bar"></div></div>
      <p id="status-text">Paste a route to inspect synchronized driver monitoring video and telemetry.</p>
    </section>
    <section id="viewer" class="viewer" hidden></section>
    <section class="info-grid">
      <article><h2>What this shows</h2><p>Awareness, active policy, distraction reasons, alerts, face/eye/blink/phone model values, pose calibration, vehicle interaction, and coarse model-derived seat boxes.</p></article>
      <article><h2>HEVC requirement</h2><p id="codec-summary">Checking native HEVC playback…</p><p class="muted">Telemetry remains useful even when this browser cannot decode the uploaded driver video.</p></article>
    </section>
  </section>`;

const form = byId<HTMLFormElement>("reader-form");
const input = byId<HTMLInputElement>("route-input");
const loadButton = byId<HTMLButtonElement>("load-button");
const shareButton = byId<HTMLButtonElement>("share-button");
const highResolutionTelemetry = byId<HTMLInputElement>("high-resolution-telemetry");
const authPanel = byId<HTMLElement>("auth-panel");
const statusText = byId<HTMLElement>("status-text");
const progressBar = byId<HTMLElement>("progress-bar");
const viewer = byId<HTMLElement>("viewer");
const support = detectHevcSupport();
byId<HTMLElement>("codec-summary").textContent = support.supported
  ? `Native HEVC is available (${support.codec}).`
  : "Native HEVC/MSE is unavailable in this browser. Video will be disabled.";

let currentRoute: DriverDebugRoute | null = null;
let videoPlayer: DriverVideoPlayer | null = null;
let authCheck: AuthCheckResult = isSignedIn() ? { status: "checking" } : { status: "missing" };

renderAuthPanel();
void initialize();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadRoute(input.value, true);
});
shareButton.addEventListener("click", () => void navigator.clipboard.writeText(window.location.href));
authPanel.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("#sign-out-button")) {
    signOut();
    authCheck = { status: "missing" };
    renderAuthPanel();
  }
  if (target.closest("#save-token-button")) {
    setAccessToken(byId<HTMLInputElement>("token-input").value);
    void verifyStoredAuth();
  }
  if (target.closest("#recheck-auth-button")) {
    void verifyStoredAuth();
  }
});

async function initialize(): Promise<void> {
  if (isSignedIn()) await verifyStoredAuth();
  await initializeFromUrl();
}

async function initializeFromUrl(): Promise<void> {
  await completePendingAuth();
  const route = routeInputFromUrl(window.location.href);
  shareButton.disabled = !route;
  if (route) {
    input.value = route;
    await loadRoute(route, false);
  }
}

async function loadRoute(routeInput: string, updateHistory: boolean): Promise<void> {
  setBusy(true);
  viewer.hidden = true;
  videoPlayer?.destroy();
  try {
    const result = await loadDriverDebugRoute(
      routeInput,
      ({ message, fraction }) => setProgress(message, fraction),
      { highResolutionTelemetry: highResolutionTelemetry.checked },
    );
    currentRoute = result;
    input.value = routeInput.trim();
    if (updateHistory) {
      window.history.pushState({}, "", buildRouteShareUrl(window.location.origin, import.meta.env.BASE_URL, routeInput));
      shareButton.disabled = false;
    }
    renderViewer(result);
    if (support.supported) await loadVideo(result);
    else setProgress("Telemetry loaded. Driver video is unavailable because native HEVC is unsupported.", 1, true);
  } catch (error) {
    setProgress(error instanceof Error ? error.message : String(error), 1, true);
  } finally {
    setBusy(false);
  }
}

function renderViewer(route: DriverDebugRoute): void {
  const duration = route.endSeconds - route.startSeconds;
  viewer.hidden = false;
  viewer.innerHTML = `
    <header class="viewer-header">
      <div><p class="eyebrow">driver-debug</p><h2>${escapeHtml(route.routeName)}</h2></div>
      <div class="route-meta"><span>${formatTime(route.startSeconds)}–${formatTime(route.endSeconds)}</span><span>${route.logSource} · ${formatHz(route.telemetryHz)}</span><span>${route.monitoring[0]?.schema ?? "unknown"} DM</span>${route.highResolutionRequested && route.logSource === "qlogs" ? "<span>rlog unavailable</span>" : ""}</div>
    </header>
    <div class="video-shell">
      <video id="driver-video" muted playsinline controls></video>
      <div class="model-input-frame" aria-hidden="true"></div>
      <div id="driver-box" class="face-box driver-box" hidden><span>DRIVER SEAT</span></div>
      <div id="other-box" class="face-box other-box" hidden><span>OTHER SEAT</span></div>
      <div id="video-placeholder" class="video-placeholder">${support.supported ? "Preparing HEVC video…" : "HEVC video unsupported — telemetry is still available"}</div>
    </div>
    <div class="transport-row">
      <span id="route-clock">${formatTime(route.startSeconds)}</span>
      <input id="route-scrubber" type="range" min="${route.startSeconds}" max="${route.endSeconds}" value="${route.startSeconds}" step="0.05" aria-label="Route time" />
      <span>${formatTime(route.endSeconds)}</span>
      <span>${duration.toFixed(1)}s clip</span>
    </div>
    <div class="state-badges" id="state-badges"></div>
    <div class="debug-grid">
      <article class="debug-card"><h3>DM state</h3><strong class="hero-value" id="awareness">--</strong><p id="awareness-detail">--</p><dl id="dm-values"></dl></article>
      <article class="debug-card"><h3>Model</h3><dl id="model-values"></dl></article>
      <article class="debug-card"><h3>Pose</h3><dl id="pose-values"></dl></article>
    </div>
    <article class="history-card"><h3>20 second history</h3><svg id="history-chart" viewBox="0 0 1000 190" preserveAspectRatio="none" aria-label="Awareness and distraction history"></svg></article>`;

  const video = byId<HTMLVideoElement>("driver-video");
  const scrubber = byId<HTMLInputElement>("route-scrubber");
  scrubber.addEventListener("input", () => {
    if (!videoPlayer) return;
    video.currentTime = Math.max(0, Number(scrubber.value) - videoPlayer.playbackRouteStart);
    renderTelemetry(Number(scrubber.value));
  });
  video.addEventListener("timeupdate", () => {
    if (!videoPlayer || !currentRoute) return;
    const routeSeconds = videoPlayer.playbackRouteStart + video.currentTime;
    if (routeSeconds >= currentRoute.endSeconds) video.pause();
    scrubber.value = String(Math.min(currentRoute.endSeconds, Math.max(currentRoute.startSeconds, routeSeconds)));
    renderTelemetry(routeSeconds);
  });
  renderTelemetry(route.startSeconds);
}

async function loadVideo(route: DriverDebugRoute): Promise<void> {
  const video = byId<HTMLVideoElement>("driver-video");
  videoPlayer = new DriverVideoPlayer(video);
  await videoPlayer.load(route.videoSources, route.startSeconds, route.endSeconds, (message, fraction) => {
    setProgress(message, 0.55 + fraction * 0.45);
  });
  const seekToStart = () => {
    if (!videoPlayer) return;
    video.currentTime = Math.max(0, route.startSeconds - videoPlayer.playbackRouteStart);
    byId<HTMLElement>("video-placeholder").hidden = true;
    setProgress("Driver Monitoring debugger ready", 1);
  };
  if (video.readyState >= 1) seekToStart();
  else video.addEventListener("loadedmetadata", seekToStart, { once: true });
}

function renderTelemetry(routeSeconds: number): void {
  const route = currentRoute;
  if (!route || viewer.hidden) return;
  const monitoring = sampleAt(route.monitoring, routeSeconds) ?? route.monitoring[0];
  const model = sampleAt(route.models, routeSeconds) ?? route.models[0];
  const vehicle = sampleAt(route.vehicles, routeSeconds);
  const { selected, other, side } = selectDriver(model, monitoring);
  byId<HTMLElement>("route-clock").textContent = formatTime(routeSeconds);
  byId<HTMLElement>("awareness").textContent = percent(monitoring.awareness);
  byId<HTMLElement>("awareness-detail").textContent = `VISION ${percent(monitoring.awarenessVision)} · WHEEL ${percent(monitoring.awarenessWheel)}`;
  byId<HTMLElement>("state-badges").innerHTML = [
    badge(`Policy ${monitoring.activePolicy}`, monitoring.activePolicy === "vision" ? "ok" : "warn"),
    badge(`Distracted ${monitoring.isDistracted ? "yes" : "no"}`, monitoring.isDistracted ? "danger" : "ok"),
    badge(`Face ${monitoring.faceDetected ? "yes" : "no"}`, monitoring.faceDetected ? "ok" : "danger"),
    monitoring.alertLevel !== "none" || monitoring.lockout ? badge(monitoring.lockout ? "too distracted" : `alert ${monitoring.alertLevel}`, "danger") : "",
  ].join("");
  byId<HTMLElement>("dm-values").innerHTML = rows([
    ["side / schema", `${side} / ${monitoring.schema}`],
    ["distracted type", monitoring.distractedTypes.join(", ") || "none"],
    ["step / speed", `${monitoring.awarenessStep.toFixed(4)} / ${vehicle ? `${vehicle.vEgo.toFixed(1)} m/s` : "--"}`],
    ["uncertain / fallback", `${monitoring.uncertainPercent}% / ${monitoring.fallbackPercent}%`],
    ["engaged / hands", `${vehicle?.enabled ? "yes" : "no"} / ${vehicle?.steeringPressed ? "on" : "off"}`],
  ]);
  byId<HTMLElement>("model-values").innerHTML = rows([
    ["selected / other / RHD", `${percent(selected?.faceProb)} / ${percent(other?.faceProb)} / ${percent(model.wheelOnRightProb)}`],
    ["eyes L / R", `${percent(selected?.leftEyeProb)} / ${percent(selected?.rightEyeProb)}`],
    ["blink L / R", `${percent(selected?.leftBlinkProb)} / ${percent(selected?.rightBlinkProb)}`],
    ["sunglasses / phone", `${percent(selected?.sunglassesProb)} / ${percent(selected?.phoneProb)}`],
    ["model / gpu", `${model.modelExecutionTime.toFixed(3)}s / ${model.gpuExecutionTime.toFixed(3)}s`],
  ]);
  byId<HTMLElement>("pose-values").innerHTML = rows([
    ["orientation", vector(selected?.faceOrientation)],
    ["position", vector(selected?.facePosition)],
    ["orient std", vector(selected?.faceOrientationStd)],
    ["pos std", vector(selected?.facePositionStd)],
    ["pitch off / calib", `${monitoring.pitchOffset.toFixed(3)} / ${monitoring.pitchCalibratedPercent}%`],
    ["yaw off / calib", `${monitoring.yawOffset.toFixed(3)} / ${monitoring.yawCalibratedPercent}%`],
  ]);
  renderFaceBox("driver-box", selected, route.routeInfo?.deviceType ?? "");
  renderFaceBox("other-box", other, route.routeInfo?.deviceType ?? "");
  renderHistory(routeSeconds, monitoring);
}

function renderFaceBox(id: string, driver: DriverModelData | null, deviceType: string): void {
  const box = byId<HTMLElement>(id);
  if (!driver || driver.facePosition.length < 2 || driver.faceProb < 0.05) {
    box.hidden = true;
    return;
  }
  const [faceX, faceY] = driver.facePosition;
  const [pitch = 0, yaw = 0] = driver.faceOrientation;
  const baseX = 1080 - 1714 * faceX;
  const baseY = -135 + 504 + Math.abs(faceX) * 112 + (1205 - Math.abs(faceX) * 724) * faceY;
  const scale = deviceType.toLowerCase() === "mici" ? 1.25 : 1;
  const centerX = 100 - (((baseX - 1080) * scale + 1080) / 2160) * 100 + yaw * 4.5;
  const centerY = (((baseY - 540) * scale + 540) / 1080) * 100 + pitch * 4;
  const uncertainty = Math.max(...driver.faceOrientationStd.slice(0, 2), 0);
  const width = Math.min(18, Math.max(7, 8 + Math.abs(yaw) * 4 + uncertainty * 4));
  box.style.left = `${Math.max(0, Math.min(100 - width, centerX - width / 2))}%`;
  box.style.top = `${Math.max(0, Math.min(80, centerY - width * 0.58))}%`;
  box.style.width = `${width}%`;
  box.style.height = `${width * 1.16}%`;
  box.hidden = false;
}

function renderHistory(routeSeconds: number, current: DriverMonitoringSample): void {
  const route = currentRoute;
  if (!route) return;
  const start = routeSeconds - 20;
  const samples = route.monitoring.filter((sample) => sample.routeSeconds >= start && sample.routeSeconds <= routeSeconds);
  const points = samples.map((sample) => {
    const x = ((sample.routeSeconds - start) / 20) * 1000;
    const y = 135 - Math.max(0, Math.min(1, sample.awareness)) * 115;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const lanes = (["eye", "phone", "pose"] as const).map((kind, lane) => samples.map((sample) => {
    if (!sample.distractedTypes.includes(kind)) return "";
    const x = ((sample.routeSeconds - start) / 20) * 1000;
    return `<rect x="${x.toFixed(1)}" y="${150 + lane * 12}" width="10" height="8" class="lane-${kind}" />`;
  }).join("")).join("");
  byId<SVGElement>("history-chart").innerHTML = `<line x1="0" y1="135" x2="1000" y2="135" class="chart-grid"/><polyline points="${points}" class="awareness-line"/>${lanes}<text x="8" y="18">awareness · ${percent(current.awareness)}</text>`;
}

function renderAuthPanel(): void {
  if (!isSignedIn()) {
    const warning = authCheck.status === "invalid" ? `<p class="auth-status invalid">That JWT was rejected and was not saved.</p>` : "";
    authPanel.innerHTML = `<details ${authCheck.status === "invalid" ? "open" : ""}><summary>Private route? Use a JWT</summary>${warning}<div class="token-row"><input id="token-input" type="password" autocomplete="off" placeholder="Paste jwt.comma.ai token"/><button class="secondary" id="save-token-button" type="button">Save and verify</button></div></details>`;
    return;
  }

  const status = authCheck.status === "valid"
    ? `<span class="auth-status valid">Verified with comma</span>`
    : authCheck.status === "error"
      ? `<span class="auth-status warning">Saved; verification unavailable</span>`
      : `<span class="auth-status checking">Checking with comma…</span>`;
  authPanel.innerHTML = `<p class="jwt-saved">JWT persisted in this browser. ${status} <button class="link-button" id="recheck-auth-button" type="button">Recheck</button> <button class="link-button" id="sign-out-button" type="button">Remove</button></p>`;
}

async function verifyStoredAuth(): Promise<void> {
  authCheck = { status: "checking" };
  renderAuthPanel();
  authCheck = await checkAccessToken();
  if (authCheck.status === "invalid") signOut();
  renderAuthPanel();
}

async function completePendingAuth(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("code") || !params.has("provider")) return;
  const result = await completeAuthCallback();
  if (result.handled && !result.error) await verifyStoredAuth();
  else renderAuthPanel();
  window.history.replaceState({}, "", buildAuthCallbackCleanUrl(window.location.href, import.meta.env.BASE_URL));
  if (result.error) setProgress(result.error, 1, true);
}

function setBusy(busy: boolean): void {
  loadButton.disabled = busy;
  input.disabled = busy;
  highResolutionTelemetry.disabled = busy;
}

function setProgress(message: string, fraction: number, error = false): void {
  statusText.textContent = message;
  progressBar.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  progressBar.classList.toggle("error", error);
}

function rows(values: Array<[string, string]>): string {
  return values.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
}

function formatHz(value: number): string {
  return value > 0 ? `${value.toFixed(value >= 10 ? 0 : 1)} Hz` : "unknown rate";
}

function badge(text: string, kind: string): string { return `<span class="state-badge ${kind}">${escapeHtml(text)}</span>`; }
function percent(value: number | undefined): string { return value === undefined || !Number.isFinite(value) ? "--" : `${Math.round(value * 100)}%`; }
function vector(value: number[] | undefined): string { return value?.length ? value.map((item) => item.toFixed(3)).join(" / ") : "--"; }
function formatTime(seconds: number): string { const minutes = Math.floor(seconds / 60); return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, "0")}`; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char); }
function byId<T extends HTMLElement | SVGElement>(id: string): T { const element = document.getElementById(id); if (!element) throw new Error(`Missing #${id}`); return element as T; }
