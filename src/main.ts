import "./styles.css";
import { checkAccessToken, completeAuthCallback, isSignedIn, setAccessToken, signOut, type AuthCheckResult } from "./auth";
import { loadDriverDebugRoute, MissingDriverVideoError, type DriverDebugRoute } from "./debugger";
import { sampleAt, selectDriver, type DriverModelData, type DriverMonitoringSample } from "./dm";
import { formatModelProvenance, modelProvenanceDetails, resolveDmModelProvenance, routeModelProvenance } from "./modelProvenance";
import { buildAuthCallbackCleanUrl, buildRouteShareUrl, buildRouteTimeUrl, parseRouteInput, routeInputFromUrl, routeTimeFromUrl } from "./routeInput";
import { scanDriverMonitoringRoute, type RouteScanUpdate } from "./scan";
import type { ScanFinding } from "./scanLogic";
import { buildMonitoringTimelineGradient, buildOnDeviceAlertMarkers, monitoringTimelineNote } from "./timeline";
import { buildDriverVideoUploadRequest, queueDriverVideoUpload, watchDriverVideoUpload } from "./uploads";
import { DriverVideoPlayer, detectHevcSupport } from "./video";

const PUBLIC_MICI_DEMO_ROUTE = "https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496/438/452";
const PUBLIC_MICI_DEMO_TIME = 446;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");

app.innerHTML = `
  <section class="tool-shell">
    <header class="masthead">
      <h1>Driver Monitoring debugger</h1>
    </header>
    <form class="reader-form" id="reader-form">
      <label for="route-input">comma Connect route or clip URL</label>
      <div class="input-row">
        <input id="route-input" autocomplete="off" spellcheck="false" placeholder="https://connect.comma.ai/&lt;dongle&gt;/&lt;route&gt;/&lt;start&gt;/&lt;end&gt;" />
        <button id="load-button" type="submit">Scan or load</button>
        <button id="demo-button" class="secondary" type="button" title="Open a public Mici clip at an 87% phone-model peak">Try demo</button>
        <button id="share-button" class="secondary" type="button" disabled>Share</button>
      </div>
      <p class="form-help"><strong>New here?</strong> <a href="#how-to-use">See the basic instructions ↓</a></p>
      <p class="form-hint">Bare routes scan for warnings and unusual DM signals. Clip URLs load their exact start/end range. Driver video never leaves your browser.</p>
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
    <section class="info-notes">
      <div><h2>What this shows</h2><p>Awareness, active policy, distraction reasons, alerts, face/eye/blink/phone model values, pose calibration, vehicle interaction, and coarse model-derived seat boxes.</p></div>
      <div><h2>HEVC requirement</h2><p id="codec-summary">Checking native HEVC playback…</p><p class="muted">Telemetry remains useful even when this browser cannot decode the uploaded driver video.</p></div>
    </section>
    <section class="usage-guide" id="how-to-use">
      <div class="usage-heading">
        <div>
          <p class="eyebrow">Basic instructions</p>
          <h2>From comma Connect to a useful driver-monitoring replay</h2>
        </div>
        <a href="#reader-form">Back to the route field ↑</a>
      </div>
      <figure class="timeline-selection-guide">
        <div class="timeline-guide-label"><strong>comma Connect timeline</strong><span>It is draggable—even though it does not look like a range control.</span></div>
        <div class="timeline-guide-track" role="img" aria-label="Drag from before an event to after it on the comma Connect timeline">
          <span class="timeline-event event-one"></span>
          <span class="timeline-event event-two"></span>
          <span class="timeline-bookmark" title="Bookmark"></span>
          <span class="timeline-selection"><i class="selection-start"></i><i class="selection-end"></i></span>
        </div>
        <div class="timeline-guide-actions"><span><strong>1. Press</strong> just before the event</span><span class="drag-action"><strong>2. Drag →</strong> across a short window</span><span><strong>3. Release</strong> to zoom and update the URL</span></div>
        <figcaption>Then copy the address-bar URL. If the selection worked, the link ends in two numbers such as <code>/247/276</code>. Drag across the zoomed timeline again to make the clip tighter.</figcaption>
      </figure>
      <ol class="usage-steps">
        <li><strong>Select a clip in <a href="https://connect.comma.ai" target="_blank" rel="noreferrer">comma Connect</a>.</strong><span>Open the drive, click near the event, then click and drag across a short part of the timeline. Release to zoom in; drag again if you need a tighter clip. Copy the URL only after selecting—the end should now look like <code>/start/end</code>.</span></li>
        <li><strong>Paste it above and choose Scan or load.</strong><span>The tool downloads telemetry first, prioritizes warning sections, and only fetches driver video when a clip is opened.</span></li>
        <li><strong>Inspect the synchronized replay.</strong><span>Scrub with the app timeline and compare the face box, awareness, policy, distraction state, pose, and model values at the same moment.</span></li>
        <li><strong>Authenticate only when needed.</strong><span>A <a href="https://jwt.comma.ai" target="_blank" rel="noreferrer">comma JWT</a> unlocks private routes and lets the device owner request missing driver-camera uploads.</span></li>
      </ol>
    </section>
    <section class="policy-note">
      <h2>Open code. Your hardware. Conditional online services.</h2>
      <p><a href="https://github.com/commaai/openpilot" target="_blank" rel="noreferrer">openpilot's MIT license</a> lets you inspect, change, and run the software. The hardware you bought is yours, too: you can modify the device and choose what software it runs. Access to comma's servers and shop is separate and conditional.</p>
      <ul class="policy-points">
        <li><strong>Do not weaken driver monitoring if you use comma's services.</strong> comma's <a href="https://github.com/commaai/openpilot/blob/master/docs/SAFETY.md#forks-of-openpilot" target="_blank" rel="noreferrer">fork safety policy</a> says violations can get a fork and its users banned. Nerfed timings and other bypasses have historically been detected through uploaded telemetry; the complete rules are not public.</li>
        <li><strong>The stated consequences can extend beyond Connect.</strong> In a <a href="https://discord.com/channels/469524606043160576/954493346250887168/1526980696894345480" target="_blank" rel="noreferrer">public warning about modified driver-monitoring code</a>, George Hotz says comma will ban offenders from its servers and, when it can identify them, from its shop.</li>
        <li><strong>A ban means “Uploads ignored.”</strong> A server ban does not disable openpilot: it can still engage and operate locally, and the device can still receive software updates. comma stops processing the device's uploaded routes for <a href="https://connect.comma.ai" target="_blank" rel="noreferrer">comma Connect</a>, and “uploads ignored” may also stop device telemetry from reaching comma's services when the device is not driving.</li>
        <li><strong>The effects spread.</strong> The hardware warranty still applies. For a device issue that occurs while driving, however, getting support may become harder: <a href="https://comma.ai/support" target="_blank" rel="noreferrer">comma support</a> requires a route from the latest stock openpilot before a hardware ticket reaches an engineer. If that device's uploads are ignored, it cannot provide a processed Connect route from the reproduction, complicating the support process. Losing routes also makes community fork debugging harder: without comma's infrastructure, fork authors and community helpers may need to walk users through manually extracting and transferring logs or video instead of opening a Connect link. Ignored drives also cannot improve comma's future driving-model datasets.</li>
      </ul>
      <p class="policy-caveat">Users have historically reported one courtesy ban reversal per device. This is not a published right or a current guarantee.</p>
      <div class="feedback-path">
        <h3>Driver monitoring false positive? Send evidence.</h3>
        <p class="feedback-lead"><strong>Getting flagged while attentive?</strong> Do not weaken or bypass driver monitoring. Use this quick check before reporting it to comma.</p>
        <p class="phone-in-hand-note"><strong>First: put down or mount the phone.</strong> Holding a phone—including while using voice-to-text—is intentionally treated as distraction by newer driver-monitoring models. In <a href="https://discord.com/channels/469524606043160576/954493346250887168/1526951756112723998" target="_blank" rel="noreferrer">explaining this behavior</a>, comma founder George Hotz (geohot) says a phone in hand is a driver-monitoring trigger and cites California <a href="https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=VEH&amp;sectionNum=23123.5." target="_blank" rel="noreferrer">Vehicle Code §23123.5</a> as a reference point. Reproduce the issue hands-free before filing a report.</p>
        <p class="feedback-priority-note"><strong>Still getting alerts hands-free? Send the segment.</strong> Hotz says comma gives genuine attentive false-positive fixes high priority; he cited rare objects such as Celsius cans being mistaken for phones. <a href="https://discord.com/channels/469524606043160576/954493346250887168/1526980696894345480" target="_blank" rel="noreferrer">Read the warning.</a></p>
        <h4 class="evidence-steps-heading">Capture the evidence</h4>
        <ol>
          <li>Enable driver-camera recording before the drive.</li>
          <li>
            When the false positive happens, tap the bookmark button.
            <figure class="bookmark-guide">
              <img src="/bookmark-route-time.gif" width="540" height="540" loading="lazy" alt="The on-device bookmark button marking the exact time of a drive" />
              <figcaption><strong>Bookmark it when it happens.</strong> The bookmark makes the exact route time easy to find later.</figcaption>
            </figure>
          </li>
          <li>After the drive appears in <a href="https://connect.comma.ai" target="_blank" rel="noreferrer">comma Connect</a>, zoom in on the bookmarked moment and request its files using the steps below.</li>
        </ol>
        <div class="connect-tutorial">
          <h4>Get the link from comma Connect</h4>
          <ol>
            <li>Open the drive in comma Connect and find its timeline strip at the top.</li>
            <li>Click the timeline near the bookmarked moment to move the playhead there.</li>
            <li>Click and drag across a short window around the moment, then release. Connect zooms into that selection; repeat if you need a tighter clip.</li>
            <li>Open the <strong>Files</strong> dropdown and request uploads for both the logs and driver camera from the zoomed-in segment.</li>
            <li>Once those uploads are available, copy the full URL from the address bar. A clipped link ends in <code>/start/end</code> and is the same kind of link accepted at the top of this tool.</li>
          </ol>
        </div>
        <p class="feedback-destination"><strong>That Connect link and the bookmarked time are the evidence.</strong> These reports do get read: comma staff review submissions, and actionable reports may be acknowledged and <a href="https://discord.com/channels/469524606043160576/1524459897016549547/1524594138719322172" target="_blank" rel="noreferrer">added to known issues</a>.</p>
        <p class="feedback-choice-heading"><strong>Choose one of these two reporting paths.</strong> You do not need to make the route public for comma staff to review it.</p>
        <ul class="feedback-sharing-options">
          <li><strong>Keep it private.</strong> Leave <strong>Make public</strong> off and post the private link and timestamp in <a href="https://discord.com/channels/469524606043160576/616456819027607567" target="_blank" rel="noreferrer">#openpilot-experience</a>. comma staff can access it; other Discord users cannot.</li>
          <li><strong>Share it publicly.</strong> Turn on <strong>Make public</strong> in comma Connect, which makes the route accessible to anyone with its link. Then use the form in <a href="https://discord.com/channels/469524606043160576/765677302205775892" target="_blank" rel="noreferrer">#submit-feedback</a> and submit it to <a href="https://discord.com/channels/469524606043160576/1254834193066623017" target="_blank" rel="noreferrer">#driving-feedback</a>. The driving-feedback channel is locked, so users cannot create posts there directly.</li>
        </ul>
      </div>
      <p class="policy-sources">Sources: <a href="https://docs.comma.ai/contributing/feedback/" target="_blank" rel="noreferrer">comma's feedback guide</a> · <a href="https://comma.ai/support" target="_blank" rel="noreferrer">comma support policy</a></p>
    </section>
    <footer class="site-footer">
      <span>Open-source under the MIT License.</span>
      <a href="https://github.com/nelsonjchen/op-dm-reading-tool" target="_blank" rel="noreferrer">View this tool on GitHub ↗</a>
    </footer>
  </section>`;

const form = byId<HTMLFormElement>("reader-form");
const input = byId<HTMLInputElement>("route-input");
const loadButton = byId<HTMLButtonElement>("load-button");
const demoButton = byId<HTMLButtonElement>("demo-button");
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
let currentScanController: AbortController | null = null;
let currentUploadController: AbortController | null = null;
let authCheck: AuthCheckResult = isSignedIn() ? { status: "checking" } : { status: "missing" };
let routeTimeUpdateTimer: number | null = null;
let pendingRouteTimeSeconds: number | null = null;
let lastRouteTimeUpdate = Number.NEGATIVE_INFINITY;

setBusy(true);
renderAuthPanel();
void initialize().finally(() => setBusy(false));

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleRouteInput(input.value, true);
});
demoButton.addEventListener("click", () => {
  void loadPublicMiciDemo();
});
shareButton.addEventListener("click", () => void navigator.clipboard.writeText(window.location.href));
authPanel.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("#sign-out-button")) {
    cancelCurrentUploadWatch();
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
viewer.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".scan-result");
  if (!button) return;
  const routeBase = button.dataset.routeBase;
  const start = Number(button.dataset.start);
  const end = Number(button.dataset.end);
  if (!routeBase || !Number.isFinite(start) || !Number.isFinite(end)) return;
  cancelCurrentScan();
  void loadRoute(`${routeBase}/${start}/${end}`, true);
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
    await handleRouteInput(route, false);
  }
}

async function handleRouteInput(routeInput: string, updateHistory: boolean): Promise<void> {
  try {
    const parsed = parseRouteInput(routeInput);
    if (parsed.explicitClipRange) await loadRoute(routeInput, updateHistory);
    else await scanRoute(routeInput, updateHistory);
  } catch (error) {
    setProgress(error instanceof Error ? error.message : String(error), 1, true);
  }
}

async function loadPublicMiciDemo(): Promise<void> {
  input.value = PUBLIC_MICI_DEMO_ROUTE;
  const routeUrl = buildRouteShareUrl(window.location.origin, import.meta.env.BASE_URL, PUBLIC_MICI_DEMO_ROUTE);
  window.history.pushState({}, "", buildRouteTimeUrl(routeUrl, PUBLIC_MICI_DEMO_TIME));
  shareButton.disabled = false;
  await loadRoute(PUBLIC_MICI_DEMO_ROUTE, false);
}

async function scanRoute(routeInput: string, updateHistory: boolean): Promise<void> {
  resetRouteTimeUrlUpdates();
  cancelCurrentScan();
  cancelCurrentUploadWatch();
  videoPlayer?.destroy();
  videoPlayer = null;
  currentRoute = null;
  const controller = new AbortController();
  currentScanController = controller;
  input.value = routeInput.trim();
  if (updateHistory) {
    window.history.pushState({}, "", buildRouteShareUrl(window.location.origin, import.meta.env.BASE_URL, routeInput));
    shareButton.disabled = false;
  }

  try {
    await scanDriverMonitoringRoute(routeInput, (update) => {
      if (currentScanController !== controller) return;
      renderRouteScan(update);
      const fraction = update.phase === "events"
        ? 0.03
        : update.totalSegments > 0 ? 0.08 + (update.scannedSegments / update.totalSegments) * 0.92 : 1;
      setProgress(update.message, fraction);
    }, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) setProgress(error instanceof Error ? error.message : String(error), 1, true);
  } finally {
    if (currentScanController === controller) currentScanController = null;
  }
}

async function loadRoute(routeInput: string, updateHistory: boolean): Promise<void> {
  resetRouteTimeUrlUpdates();
  cancelCurrentScan();
  cancelCurrentUploadWatch();
  setBusy(true);
  viewer.hidden = true;
  videoPlayer?.destroy();
  videoPlayer = null;
  input.value = routeInput.trim();
  if (updateHistory) {
    window.history.pushState({}, "", buildRouteShareUrl(window.location.origin, import.meta.env.BASE_URL, routeInput));
    shareButton.disabled = false;
  }
  try {
    const result = await loadDriverDebugRoute(
      routeInput,
      ({ message, fraction }) => setProgress(message, fraction),
      { highResolutionTelemetry: highResolutionTelemetry.checked },
    );
    currentRoute = result;
    renderViewer(result);
    void updateModelProvenance(result);
    setProgress(
      support.supported
        ? "Telemetry ready · preparing driver video"
        : "Telemetry ready · driver video is unavailable because native HEVC is unsupported",
      1,
      !support.supported,
    );
    if (support.supported) void loadRequestedVideo(result);
  } catch (error) {
    if (error instanceof MissingDriverVideoError) {
      renderMissingDriverVideo(error, routeInput);
      setProgress("Driver-camera video is not uploaded for this clip", 1, true);
    } else {
      setProgress(error instanceof Error ? error.message : String(error), 1, true);
    }
  } finally {
    setBusy(false);
    restoreInstructionAnchor();
  }
}

function restoreInstructionAnchor(): void {
  if (window.location.hash !== "#how-to-use") return;
  window.requestAnimationFrame(() => byId<HTMLElement>("how-to-use").scrollIntoView({ block: "start" }));
}

function renderMissingDriverVideo(error: MissingDriverVideoError, routeInput: string): void {
  viewer.hidden = false;
  const segmentLabel = error.segments.length === 1 ? `segment ${error.segments[0]}` : `${error.segments.length} clip segments`;
  viewer.innerHTML = `<section class="missing-video">
    <h2>Driver video is not uploaded</h2>
    <p>The selected ${segmentLabel} may still be on the device. Driver-camera recording must have been enabled when this drive occurred.</p>
    ${isSignedIn()
      ? `<button id="queue-video-upload" type="button">Request upload from device</button><small>Queues over comma Athena, waits for Wi-Fi, and opens the clip automatically when ready.</small>
        <div id="upload-progress" class="upload-progress" role="progressbar" aria-label="Driver-video upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden>
          <div class="upload-progress-heading"><span id="upload-progress-message">Requesting upload…</span><strong id="upload-progress-percent">0%</strong></div>
          <div class="upload-progress-track"><i id="upload-progress-bar"></i></div>
        </div>`
      : `<p class="muted">Authenticate above with the device owner's comma JWT to request the missing file.</p>`}
  </section>`;
  if (!isSignedIn()) return;
  byId<HTMLButtonElement>("queue-video-upload").addEventListener("click", () => {
    void queueAndWatchDriverVideo(error, routeInput);
  });
}

async function queueAndWatchDriverVideo(error: MissingDriverVideoError, routeInput: string): Promise<void> {
  cancelCurrentUploadWatch();
  const controller = new AbortController();
  currentUploadController = controller;
  const button = byId<HTMLButtonElement>("queue-video-upload");
  button.disabled = true;
  button.textContent = "Requesting upload…";
  renderUploadProgress("Requesting upload…", 0);
  const request = buildDriverVideoUploadRequest(error.routeName, error.segments);
  try {
    const queued = await queueDriverVideoUpload(request);
    if (currentUploadController !== controller) return;
    button.textContent = "Watching upload…";
    renderUploadProgress(queued, 0);
    setProgress(queued, 0.08);
    await watchDriverVideoUpload(request, ({ message, progress }) => {
      if (currentUploadController !== controller) return;
      renderUploadProgress(message, progress);
      setProgress(message, 0.08 + (progress ?? 0) * 0.92);
    }, controller.signal);
    if (currentUploadController !== controller) return;
    currentUploadController = null;
    renderUploadProgress("Driver video uploaded", 1);
    setProgress("Driver video uploaded · opening clip", 1);
    await loadRoute(routeInput, false);
  } catch (uploadError) {
    if (controller.signal.aborted || currentUploadController !== controller) return;
    currentUploadController = null;
    button.disabled = false;
    button.textContent = "Try upload again";
    renderUploadProgress("Upload request failed", undefined, true);
    setProgress(uploadError instanceof Error ? uploadError.message : String(uploadError), 1, true);
  }
}

function renderUploadProgress(message: string, progress?: number, error = false): void {
  const container = document.querySelector<HTMLElement>("#upload-progress");
  const label = document.querySelector<HTMLElement>("#upload-progress-message");
  const percentLabel = document.querySelector<HTMLElement>("#upload-progress-percent");
  const bar = document.querySelector<HTMLElement>("#upload-progress-bar");
  if (!container || !label || !percentLabel || !bar) return;
  const previous = Number(container.getAttribute("aria-valuenow") ?? 0) / 100;
  const fraction = Math.min(1, Math.max(0, progress ?? previous));
  const percent = Math.round(fraction * 100);
  container.hidden = false;
  container.classList.toggle("error", error);
  container.setAttribute("aria-valuenow", String(percent));
  label.textContent = message;
  percentLabel.textContent = `${percent}%`;
  bar.style.width = `${percent}%`;
}

function renderRouteScan(update: RouteScanUpdate): void {
  viewer.hidden = false;
  const routeBase = `https://connect.comma.ai/${update.dongleId}/${update.routeId}`;
  const rows = update.findings.map((finding) => scanFindingRow(finding, routeBase)).join("");
  const empty = update.phase === "complete"
    ? `<p class="scan-empty">No DM alerts or unusual signals were found.</p>`
    : `<p class="scan-empty">Warnings and suggestions will appear here as prioritized qlogs finish.</p>`;
  viewer.innerHTML = `
    <header class="scan-header">
      <div><h2>${escapeHtml(update.routeName)}</h2><p>Scanning qlogs in warning-first order</p></div>
      <p class="scan-count">${update.scannedSegments}/${update.totalSegments}${update.failedSegments ? ` · ${update.failedSegments} failed` : ""}</p>
    </header>
    <div class="scan-list">${rows || empty}</div>`;
}

function scanFindingRow(finding: ScanFinding, routeBase: string): string {
  const clipStart = Math.max(0, Math.floor(finding.startSeconds - 8));
  const clipEnd = Math.max(clipStart + 5, Math.ceil(finding.endSeconds + 8));
  const explanation = finding.reasons.length > 0 ? finding.reasons.join(" · ") : "No additional reason recorded";
  const source = finding.dmConfirmed ? "confirmed from DM state" : finding.source === "connect" ? "Connect timeline; checking DM state" : "suggested from DM signals";
  return `<button class="scan-result severity-${finding.severity}" type="button" data-route-base="${escapeHtml(routeBase)}" data-start="${clipStart}" data-end="${clipEnd}">
    <span class="scan-time">${formatTime(finding.startSeconds)}–${formatTime(finding.endSeconds)}</span>
    <strong>${escapeHtml(finding.title)}</strong>
    <span>${escapeHtml(explanation)}</span>
    <small>${escapeHtml(source)} · open ${formatTime(clipStart)}–${formatTime(clipEnd)}</small>
  </button>`;
}

function cancelCurrentScan(): void {
  currentScanController?.abort();
  currentScanController = null;
}

function cancelCurrentUploadWatch(): void {
  currentUploadController?.abort();
  currentUploadController = null;
}

function renderViewer(route: DriverDebugRoute): void {
  const duration = route.endSeconds - route.startSeconds;
  const initialRouteSeconds = deepLinkedRouteTime(route);
  const timelineNote = monitoringTimelineNote(route.monitoring);
  const alertMarkers = buildOnDeviceAlertMarkers(route.monitoring, route.startSeconds, route.endSeconds);
  const initialProvenance = routeModelProvenance(route.routeInfo);
  viewer.hidden = false;
  viewer.innerHTML = `
    <header class="viewer-header">
      <h2>${escapeHtml(route.routeName)}</h2>
      <div class="route-meta"><span>${formatTime(route.startSeconds)}–${formatTime(route.endSeconds)}</span><span>${route.logSource} · ${formatHz(route.telemetryHz)}</span>${route.highResolutionRequested && route.logSource === "qlogs" ? "<span>rlog unavailable</span>" : ""}</div>
    </header>
    <p id="model-provenance" class="model-provenance">${escapeHtml(formatModelProvenance(initialProvenance, true))}</p>
    <div class="video-shell">
      <video id="driver-video" muted playsinline></video>
      <div class="model-input-frame" aria-hidden="true"></div>
      <div id="driver-box" class="face-box driver-box" role="button" tabindex="0" aria-label="Fade driver seat overlay" aria-pressed="false" title="Hover or tap to see the face" hidden><span>DRIVER SEAT</span></div>
      <div id="other-box" class="face-box other-box" role="button" tabindex="0" aria-label="Fade other seat overlay" aria-pressed="false" title="Hover or tap to see the face" hidden><span>OTHER SEAT</span></div>
      <div id="video-placeholder" class="video-placeholder">
        <div class="video-load-panel">
          <p id="video-placeholder-copy">${support.supported ? "Preparing driver video…" : "HEVC video unsupported — telemetry is still available."}</p>
          ${support.supported ? `<button id="load-video-button" type="button">Load driver video</button><small>Downloads the selected byte range and remuxes it in memory.</small>` : ""}
        </div>
      </div>
    </div>
    <div class="transport-row">
      <button id="playback-toggle" class="transport-button" type="button" disabled>Play</button>
      <span id="route-clock">${formatTime(route.startSeconds)}</span>
      <div class="timeline-control">
        <input id="route-scrubber" type="range" min="${route.startSeconds}" max="${route.endSeconds}" value="${initialRouteSeconds}" step="0.05" aria-label="Route time" />
        <div class="timeline-alert-markers" aria-label="On-device driver monitoring alerts">${alertMarkers.map((marker) => {
          const width = Math.max(0.35, marker.endPercent - marker.startPercent);
          return `<i class="timeline-alert-marker ${marker.severity}" style="left:${marker.startPercent.toFixed(2)}%;width:${width.toFixed(2)}%" title="${marker.severity === "early" ? "Early on-device alert" : marker.severity === "warning" ? "On-device warning" : "Critical alert or lockout"}"></i>`;
        }).join("")}</div>
      </div>
      <span>${formatTime(route.endSeconds)}</span>
      <span>${duration.toFixed(1)}s clip</span>
    </div>
    <div class="transport-legend" aria-label="Driver monitoring timeline legend">
      <strong>Driver monitoring timeline</strong>
      <span><i class="timeline-normal"></i>Normal</span>
      <span><i class="timeline-suggestion"></i>Model concern</span>
      <span><i class="timeline-degraded"></i>Low awareness / early alert</span>
      <span><i class="timeline-warning"></i>Distraction signal / warning</span>
      <span><i class="timeline-critical"></i>Critical / lockout</span>
      <span><i class="timeline-on-device-alert"></i>On-device alert glow</span>
    </div>
    <p class="transport-note">${escapeHtml(timelineNote)}</p>
    <div class="state-badges" id="state-badges"></div>
    <div class="debug-grid">
      <article class="debug-card"><h3>DM state</h3><strong class="hero-value" id="awareness">--</strong><p id="awareness-detail">--</p><dl id="dm-values"></dl></article>
      <article class="debug-card"><h3>Model</h3><dl id="model-values"></dl></article>
      <article class="debug-card"><h3>Pose</h3><dl id="pose-values"></dl></article>
    </div>
    <article class="history-card">
      <div class="history-heading">
        <h3>20 second history</h3>
        <div class="history-legend" aria-label="Distraction history legend">
          <span><i class="legend-eye"></i>Eye</span>
          <span><i class="legend-phone"></i>Phone</span>
          <span><i class="legend-pose"></i>Pose</span>
        </div>
      </div>
      <svg id="history-chart" viewBox="0 0 1000 190" preserveAspectRatio="none" aria-label="Awareness and distraction history"></svg>
    </article>`;

  const video = byId<HTMLVideoElement>("driver-video");
  const scrubber = byId<HTMLInputElement>("route-scrubber");
  for (const id of ["driver-box", "other-box"]) {
    const box = byId<HTMLElement>(id);
    const togglePeek = () => {
      const peeking = box.classList.toggle("peek");
      box.setAttribute("aria-pressed", String(peeking));
    };
    box.addEventListener("click", togglePeek);
    box.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      togglePeek();
    });
  }
  scrubber.style.setProperty("--dm-timeline", buildMonitoringTimelineGradient(route.monitoring, route.startSeconds, route.endSeconds, route.models));
  const playbackToggle = byId<HTMLButtonElement>("playback-toggle");
  if (support.supported) {
    byId<HTMLButtonElement>("load-video-button").addEventListener("click", () => void loadRequestedVideo(route));
  }
  scrubber.addEventListener("input", () => {
    const routeSeconds = Number(scrubber.value);
    videoPlayer?.seek(routeSeconds);
    renderTelemetry(routeSeconds);
    queueRouteTimeUrlUpdate(routeSeconds);
  });
  playbackToggle.addEventListener("click", () => {
    if (video.paused) void video.play();
    else video.pause();
  });
  video.addEventListener("play", () => { playbackToggle.textContent = "Pause"; });
  video.addEventListener("pause", () => { playbackToggle.textContent = "Play"; });
  video.addEventListener("timeupdate", () => {
    if (!videoPlayer || !currentRoute) return;
    const routeSeconds = videoPlayer.playbackRouteStart + video.currentTime;
    if (routeSeconds >= currentRoute.endSeconds) video.pause();
    scrubber.value = String(Math.min(currentRoute.endSeconds, Math.max(currentRoute.startSeconds, routeSeconds)));
    renderTelemetry(routeSeconds);
    queueRouteTimeUrlUpdate(routeSeconds);
  });
  renderTelemetry(initialRouteSeconds);
  queueRouteTimeUrlUpdate(initialRouteSeconds);
}

async function updateModelProvenance(route: DriverDebugRoute): Promise<void> {
  const provenance = await resolveDmModelProvenance(route.routeInfo);
  if (currentRoute !== route) return;
  const element = document.querySelector<HTMLElement>("#model-provenance");
  if (!element) return;
  element.textContent = formatModelProvenance(provenance);
  element.title = modelProvenanceDetails(provenance);
}

async function loadRequestedVideo(route: DriverDebugRoute): Promise<void> {
  if (currentRoute !== route || videoPlayer) return;
  const button = byId<HTMLButtonElement>("load-video-button");
  button.disabled = true;
  button.textContent = "Loading video…";
  byId<HTMLElement>("video-placeholder-copy").textContent = "Downloading and remuxing the selected HEVC clip…";
  try {
    await loadVideo(route);
  } catch (error) {
    (videoPlayer as DriverVideoPlayer | null)?.destroy();
    videoPlayer = null;
    if (currentRoute !== route) return;
    button.disabled = false;
    button.textContent = "Retry video";
    byId<HTMLElement>("video-placeholder-copy").textContent = "Video loading failed. Telemetry is still available.";
    setProgress(error instanceof Error ? error.message : String(error), 1, true);
  }
}

async function loadVideo(route: DriverDebugRoute): Promise<void> {
  const video = byId<HTMLVideoElement>("driver-video");
  const player = new DriverVideoPlayer(video);
  videoPlayer = player;
  let playbackReady = false;
  await player.load(route.videoSources, route.startSeconds, route.endSeconds, (message, fraction) => {
    if (playbackReady || videoPlayer !== player || currentRoute !== route) return;
    setProgress(message, 0.55 + fraction * 0.45);
  }, (error) => {
    if (videoPlayer !== player || currentRoute !== route) return;
    setProgress(error instanceof Error ? error.message : String(error), 1, true);
  });
  player.seek(deepLinkedRouteTime(route));
  playbackReady = true;
  if (videoPlayer !== player || currentRoute !== route) {
    player.destroy();
    return;
  }
  const seekToStart = () => {
    if (videoPlayer !== player || currentRoute !== route) return;
    byId<HTMLButtonElement>("playback-toggle").disabled = false;
    byId<HTMLElement>("video-placeholder").hidden = true;
    setProgress("Driver Monitoring debugger ready", 1);
  };
  if (video.readyState >= 1) seekToStart();
  else video.addEventListener("loadedmetadata", seekToStart, { once: true });
}

function deepLinkedRouteTime(route: DriverDebugRoute): number {
  const requested = routeTimeFromUrl(window.location.href);
  if (requested === null) return route.startSeconds;
  return Math.min(route.endSeconds, Math.max(route.startSeconds, requested));
}

function queueRouteTimeUrlUpdate(routeSeconds: number): void {
  const route = currentRoute;
  if (!route || !Number.isFinite(routeSeconds)) return;
  pendingRouteTimeSeconds = Math.floor(Math.min(route.endSeconds, Math.max(route.startSeconds, routeSeconds)));
  const elapsed = performance.now() - lastRouteTimeUpdate;
  if (elapsed >= 1_000) {
    flushRouteTimeUrlUpdate();
    return;
  }
  if (routeTimeUpdateTimer !== null) return;
  routeTimeUpdateTimer = window.setTimeout(flushRouteTimeUrlUpdate, 1_000 - elapsed);
}

function flushRouteTimeUrlUpdate(): void {
  routeTimeUpdateTimer = null;
  const routeSeconds = pendingRouteTimeSeconds;
  pendingRouteTimeSeconds = null;
  if (routeSeconds === null) return;
  const nextUrl = buildRouteTimeUrl(window.location.href, routeSeconds);
  if (nextUrl !== window.location.href) window.history.replaceState({}, "", nextUrl);
  lastRouteTimeUpdate = performance.now();
}

function resetRouteTimeUrlUpdates(): void {
  if (routeTimeUpdateTimer !== null) window.clearTimeout(routeTimeUpdateTimer);
  routeTimeUpdateTimer = null;
  pendingRouteTimeSeconds = null;
  lastRouteTimeUpdate = Number.NEGATIVE_INFINITY;
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
    ["driver-seat face confidence", percent(selected?.faceProb)],
    ["other-seat face confidence", percent(other?.faceProb)],
    ["right-hand-drive confidence", percent(model.wheelOnRightProb)],
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
    const warning = authCheck.status === "invalid" ? `<p class="auth-status invalid">comma rejected that JWT, so it was not saved.</p>` : "";
    authPanel.innerHTML = `<section class="auth-prompt" aria-labelledby="auth-heading">
      <strong id="auth-heading">Private route or missing driver video?</strong>
      <div class="auth-explanation">
        <p>Authenticate to comma with a JWT to:</p>
        <ul>
          <li>open your private comma routes;</li>
          <li>request missing driver video from a device you own; or</li>
          <li>watch a queued device upload and open the clip when it is ready.</li>
        </ul>
        <p>Public routes need no authentication. Get a token from <a href="https://jwt.comma.ai" target="_blank" rel="noreferrer">jwt.comma.ai</a>; it is saved only in this browser.</p>
      </div>
      ${warning}
      <div class="token-row"><input id="token-input" type="password" autocomplete="off" aria-label="comma JWT" placeholder="Paste comma JWT"/><button class="secondary" id="save-token-button" type="button">Authenticate</button></div>
    </section>`;
    return;
  }

  const status = authCheck.status === "valid"
    ? `<span class="auth-status valid">Verified with comma</span>`
    : authCheck.status === "error"
      ? `<span class="auth-status warning">Saved; verification unavailable</span>`
      : `<span class="auth-status checking">Checking with comma…</span>`;
  authPanel.innerHTML = `<p class="jwt-saved"><strong>Authenticated to comma with a saved JWT.</strong> Private routes are enabled; device uploads require its owner's JWT. ${status} <button class="link-button" id="recheck-auth-button" type="button">Recheck</button> <button class="link-button" id="sign-out-button" type="button">Remove</button></p>`;
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
  demoButton.disabled = busy;
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
