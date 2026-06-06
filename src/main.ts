import "./styles.css";
import { completeAuthCallback, isSignedIn, setAccessToken, signOut } from "./auth";
import { CALIBRATION_LIMITS, COMMA_JWT_PORTAL_URL, GITHUB_REPO_URL, MOUNT_INSTALL_TEMPLATES_URL, OPENPILOT_MASTER_SOURCES } from "./constants";
import { formatAngle, formatDegrees, formatLogMonoTime, pitchDirection, yawDirection, deviceLimitKey } from "./format";
import { buildRouteShareUrl, parseRouteInput, routeInputFromUrl } from "./routeInput";
import { scanRouteForFirstValidCalibration, scanRouteForInvalidCalibration, type CalibrationScanResult } from "./scan";

type ScanMode = "quick" | "full";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");

app.innerHTML = `
  <section class="tool-shell">
    <header class="masthead">
      <div>
        <p class="eyebrow">openpilot route utility</p>
        <h1>Invalid calibration scanner</h1>
      </div>
    </header>

    <form class="reader-form" id="reader-form">
      <label for="route-input">comma Connect URL or public route</label>
      <div class="input-row">
        <input id="route-input" name="route" autocomplete="off" spellcheck="false"
          placeholder="Paste Connect URL here, e.g. https://connect.comma.ai/<dongle>/<route>" />
        <button class="scan-button" type="submit" name="scan-mode" value="quick">Quick look</button>
        <button class="scan-button secondary" type="submit" name="scan-mode" value="full">Full scan</button>
        <button class="secondary share-button" id="share-button" type="button" disabled>Share</button>
      </div>
      <p class="form-hint">Quick look stops at the first valid calibration. Full scan checks the route for invalid calibration and shows the previous valid value when available.</p>
      <button class="ghost-button" id="demo-button" type="button">Use demo route</button>
    </form>

    <section class="status-panel" id="status-panel" aria-live="polite">
      <div class="progress-track"><div id="progress-bar"></div></div>
      <p id="status-text">Paste a public route for a quick calibration look, or run a full qlog scan for invalid calibration.</p>
    </section>

    <section id="result-panel" class="result-panel" hidden></section>

    <section class="info-grid">
      <article>
        <h2>How to get an input route</h2>
        <ol>
          <li>Open <a href="https://connect.comma.ai/" target="_blank" rel="noreferrer">comma Connect</a> and select the drive.</li>
          <li>Open <strong>More info</strong> and turn on <strong>Public access</strong>.</li>
          <li>Copy either the browser URL or the route name. A current URL looks like <code>https://connect.comma.ai/&lt;dongle&gt;/&lt;route&gt;</code>. If clip start/end seconds are included after the route, they are ignored.</li>
          <li>You can turn Public access off again after reading the route.</li>
        </ol>
        <div class="jwt-option" id="auth-panel"></div>
      </article>
      <article>
        <h2>Current tolerated values</h2>
        <p>This scanner flags logged invalid calibration, or calibration outside these current openpilot pitch/yaw limits.</p>
        <dl class="limits">
          <div>
            <dt>tici / comma 3 and tizi / comma 3x</dt>
            <dd>${formatDegrees(CALIBRATION_LIMITS.default.pitchMinRad)} up to ${formatDegrees(CALIBRATION_LIMITS.default.pitchMaxRad)} down, yaw ${formatDegrees(CALIBRATION_LIMITS.default.yawMinRad)} to ${formatDegrees(CALIBRATION_LIMITS.default.yawMaxRad)}</dd>
          </div>
          <div>
            <dt>mici / comma four</dt>
            <dd>${formatDegrees(CALIBRATION_LIMITS.mici.pitchMinRad)} up to ${formatDegrees(CALIBRATION_LIMITS.mici.pitchMaxRad)} down, yaw ${formatDegrees(CALIBRATION_LIMITS.mici.yawMinRad)} to ${formatDegrees(CALIBRATION_LIMITS.mici.yawMaxRad)}</dd>
          </div>
        </dl>
        <p class="muted">The device settings copy rounds this to within 4° left/right and within 5° up or 9° down for tici / comma 3 and tizi / comma 3x.</p>
      </article>
    </section>

    <section class="related-tool">
      <h2>Remounting or installing?</h2>
      <p>Community-made <a href="${MOUNT_INSTALL_TEMPLATES_URL}" target="_blank" rel="noreferrer">printable mount templates</a>
      can help place comma 3, comma 3x, and comma four mounts before sticking them to the windshield.</p>
    </section>

    <footer>
      Route file discovery follows comma Connect's public <a href="${OPENPILOT_MASTER_SOURCES.commaApi}" target="_blank" rel="noreferrer">route files API</a>
      and the newer Connect file upload model in <a href="${OPENPILOT_MASTER_SOURCES.newConnectFileApi}" target="_blank" rel="noreferrer">commaai/new-connect</a>.
      Calibration limits come from <a href="${OPENPILOT_MASTER_SOURCES.calibrationd}" target="_blank" rel="noreferrer">openpilot calibrationd</a>,
      and fields come from the <a href="${OPENPILOT_MASTER_SOURCES.logSchema}" target="_blank" rel="noreferrer">openpilot log schema</a>.
      Source: <a href="${GITHUB_REPO_URL}" target="_blank" rel="noreferrer">GitHub</a>.
    </footer>
  </section>
`;

const form = document.querySelector<HTMLFormElement>("#reader-form")!;
const input = document.querySelector<HTMLInputElement>("#route-input")!;
const scanButtons = [...document.querySelectorAll<HTMLButtonElement>(".scan-button")];
const shareButton = document.querySelector<HTMLButtonElement>("#share-button")!;
const demoButton = document.querySelector<HTMLButtonElement>("#demo-button")!;
const statusText = document.querySelector<HTMLParagraphElement>("#status-text")!;
const progressBar = document.querySelector<HTMLDivElement>("#progress-bar")!;
const resultPanel = document.querySelector<HTMLElement>("#result-panel")!;
const authPanel = document.querySelector<HTMLElement>("#auth-panel")!;
let renderGeneration = 0;

renderAuthPanel();
void initializeFromUrl();

demoButton.addEventListener("click", () => {
  input.value = "https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496";
  input.focus();
});

authPanel.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.closest("#sign-out-button")) {
    signOut();
    renderAuthPanel();
    statusText.textContent = "Signed out. Public route scanning still works.";
    return;
  }

  if (target.closest("#save-token-button")) {
    const tokenInput = document.querySelector<HTMLInputElement>("#token-input");
    setAccessToken(tokenInput?.value ?? null);
    renderAuthPanel();
    statusText.textContent = isSignedIn()
      ? "Saved JWT in this browser."
      : "No JWT was saved.";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter instanceof HTMLButtonElement ? event.submitter : null;
  const mode = submitter?.value === "full" ? "full" : "quick";
  await submitRoute(input.value, mode, { updateHistory: true });
});

shareButton.addEventListener("click", () => {
  if (!routeInputFromUrl(window.location.href)) return;
  void copyText(window.location.href).then((copied) => {
    showCopyFeedback(shareButton, copied);
  });
});

window.addEventListener("popstate", () => {
  const routeName = routeInputFromUrl(window.location.href);
  setShareButtonState();
  if (!routeName) {
    input.value = "";
    clearResult();
    progressBar.classList.remove("error");
    progressBar.style.width = "0";
    statusText.textContent = "Paste a public route for a quick calibration look, or run a full qlog scan for invalid calibration.";
    return;
  }
  input.value = routeName;
  void submitRoute(routeName, "quick", { updateHistory: false });
});

async function submitRoute(routeInput: string, mode: ScanMode, options: { updateHistory: boolean }): Promise<void> {
  clearResult();

  let routeName: string;
  try {
    routeName = parseRouteInput(routeInput).routeName;
  } catch (error) {
    if (options.updateHistory) {
      window.history.pushState({}, "", new URL(import.meta.env.BASE_URL, window.location.origin));
    }
    statusText.textContent = error instanceof Error ? error.message : String(error);
    progressBar.style.width = "100%";
    progressBar.classList.add("error");
    setShareButtonState();
    return;
  }

  input.value = routeName;
  if (options.updateHistory) {
    window.history.pushState({}, "", buildRouteShareUrl(window.location.origin, import.meta.env.BASE_URL, routeName));
    setShareButtonState();
  }

  setBusy(true);

  try {
    const scanner = mode === "full" ? scanRouteForInvalidCalibration : scanRouteForFirstValidCalibration;
    const result = await scanner(routeName, (progress) => {
      statusText.textContent = progress.message;
      if (progress.total && progress.current) {
        progressBar.style.width = `${Math.max(5, (progress.current / progress.total) * 100)}%`;
      } else {
        progressBar.style.width = progress.phase === "done" ? "100%" : "8%";
      }
    });
    renderResult(result);
    void loadQcameraPreview(result, renderGeneration);
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : String(error);
    progressBar.style.width = "100%";
    progressBar.classList.add("error");
  } finally {
    setBusy(false);
  }
}

function setBusy(busy: boolean): void {
  for (const button of scanButtons) {
    button.disabled = busy;
  }
  demoButton.disabled = busy;
  input.disabled = busy;
  progressBar.classList.toggle("error", false);
  if (busy) progressBar.style.width = "4%";
}

function setShareButtonState(): void {
  shareButton.disabled = !routeInputFromUrl(window.location.href);
}

function clearResult(): void {
  renderGeneration += 1;
  resultPanel.hidden = true;
  resultPanel.innerHTML = "";
}

function renderAuthPanel(): void {
  if (isSignedIn()) {
    authPanel.innerHTML = `
      <p class="jwt-saved">JWT saved. <button class="link-button" id="sign-out-button" type="button">Remove</button></p>
    `;
    return;
  }

  authPanel.innerHTML = `
    <details class="token-details">
      <summary>Private route? Use a JWT</summary>
      <ol class="jwt-steps">
        <li>Open <a href="${COMMA_JWT_PORTAL_URL}" target="_blank" rel="noreferrer">jwt.comma.ai</a>.</li>
        <li>Copy the JWT.</li>
        <li>Paste it here.</li>
      </ol>
      <div class="token-row">
        <input id="token-input" type="password" autocomplete="off" spellcheck="false" placeholder="Paste JWT here" />
        <button class="secondary" id="save-token-button" type="button">Use JWT</button>
      </div>
    </details>
  `;
}

async function completePendingAuth(): Promise<void> {
  const authParams = new URLSearchParams(window.location.search);
  if (!authParams.has("code") || !authParams.has("provider")) return;
  statusText.textContent = "Completing comma sign-in...";
  progressBar.style.width = "8%";
  const result = await completeAuthCallback();
  progressBar.style.width = "100%";
  renderAuthPanel();
  if (!result.handled) return;
  if (result.error) {
    progressBar.classList.add("error");
    statusText.textContent = result.error;
  } else {
    progressBar.classList.remove("error");
    statusText.textContent = "Signed in with comma. Paste a route and scan when ready.";
  }
}

async function initializeFromUrl(): Promise<void> {
  await completePendingAuth();
  const routeName = routeInputFromUrl(window.location.href);
  setShareButtonState();
  if (!routeName) return;
  input.value = routeName;
  await submitRoute(routeName, "quick", { updateHistory: false });
}

function renderResult(result: CalibrationScanResult): void {
  const message = result.message;
  if (!message) return;
  const limitKey = deviceLimitKey(result.routeInfo);
  const limits = CALIBRATION_LIMITS[limitKey];
  const pitch = message.rpyCalib[1];
  const yaw = message.rpyCalib[2];
  const roll = message.rpyCalib[0];

  const isInvalid = result.resultType === "invalid";
  const isIncomplete = result.resultType === "incomplete";
  const isFullAllClear = result.scanMode === "full" && result.resultType === "valid";
  const isQuick = result.scanMode === "quick";
  const resultEyebrow = isQuick
    ? "quick calibration look"
    : isIncomplete
      ? "partial route scan"
      : isFullAllClear
        ? "route calibration all clear"
        : "earliest invalid calibration";
  const resultBadge = isQuick
    ? "first valid calibration"
    : isIncomplete
      ? "scan incomplete"
    : isFullAllClear
      ? "no invalid calibration found"
      : result.reason === "status-invalid"
        ? "logged invalid"
        : "outside current limits";
  const resultBadgeClass = isInvalid || isIncomplete ? "warn" : "ok";
  const segmentText = isFullAllClear
    ? `${result.totalSegments} ${logFileKind(result.logSource)} segment(s), earliest valid calibration in segment ${result.segment}`
    : isIncomplete
      ? `${result.scannedSegments} of ${result.totalSegments} ${logFileKind(result.logSource)} segment(s) decoded, earliest valid calibration in segment ${result.segment}`
    : isQuick
      ? `${result.segment} after scanning ${result.scannedSegments} ${logFileKind(result.logSource)} segment(s)`
    : `${result.segment} after scanning ${result.scannedSegments} ${logFileKind(result.logSource)} segment(s)`;
  const toleranceMarkup = renderToleranceVisualization(message, result.routeInfo, "Tolerance landing");
  const readFailuresMarkup = result.readFailures.length > 0 ? renderReadFailures(result) : "";
  const qcameraPreviewMarkup = renderQcameraPreview(result);
  const previousValidMarkup =
    isInvalid && result.previousValid
      ? renderPreviousValid(result.previousValid, result.routeInfo)
      : isInvalid
        ? `<section class="previous-valid"><h3>Previous valid calibration</h3><p class="muted">No valid calibration was seen before this invalid event in the scanned logs.</p></section>`
        : "";

  resultPanel.hidden = false;
  resultPanel.innerHTML = `
    <div class="result-header">
      <div>
        <p class="eyebrow">${resultEyebrow}</p>
        <h2>${formatAngle(pitch)} pitch ${pitchDirection(pitch)}, ${formatAngle(yaw)} yaw ${yawDirection(yaw)}</h2>
      </div>
      <span class="badge ${resultBadgeClass}">${resultBadge}</span>
    </div>
    <dl class="result-list">
      <div><dt>Route</dt><dd><code>${escapeHtml(result.routeName)}</code></dd></div>
      <div><dt>Segment</dt><dd>${segmentText}</dd></div>
      <div><dt>Status</dt><dd>${message.statusName} (${message.calPerc}% complete, ${message.validBlocks} valid blocks)</dd></div>
      <div><dt>Device tolerance</dt><dd>${limits.label}</dd></div>
      <div><dt>Roll / pitch / yaw</dt><dd>${formatAngle(roll)} / ${formatAngle(pitch)} / ${formatAngle(yaw)}</dd></div>
      <div><dt>Spread</dt><dd>${message.rpyCalibSpread.map(formatAngle).join(" / ") || "n/a"}</dd></div>
      <div><dt>Height</dt><dd>${message.height.length ? `${message.height[0].toFixed(2)} m` : "n/a"}</dd></div>
      <div><dt>Log mono time</dt><dd>${formatLogMonoTime(message.logMonoTime)}</dd></div>
      <div><dt>Source log</dt><dd>${result.logSource === "qlogs" ? "qlog" : "rlog"}</dd></div>
      <div><dt>Applied tolerance</dt><dd>${limits.label}: pitch ${formatDegrees(limits.pitchMinRad)} to ${formatDegrees(limits.pitchMaxRad)}, yaw ${formatDegrees(limits.yawMinRad)} to ${formatDegrees(limits.yawMaxRad)}</dd></div>
    </dl>
    ${readFailuresMarkup}
    ${qcameraPreviewMarkup}
    ${toleranceMarkup}
    ${previousValidMarkup}
  `;
}

function logFileKind(source: CalibrationScanResult["logSource"]): "qlog" | "rlog" {
  return source === "qlogs" ? "qlog" : "rlog";
}

function renderToleranceVisualization(message: NonNullable<CalibrationScanResult["message"]>, routeInfo: CalibrationScanResult["routeInfo"], title: string): string {
  const limitKey = deviceLimitKey(routeInfo);
  const limits = CALIBRATION_LIMITS[limitKey];
  return `
    <section class="tolerance-visual">
      <h3>${title}</h3>
      ${renderToleranceRow("Pitch", message.rpyCalib[1], limits.pitchMinRad, limits.pitchMaxRad, {
        minLabel: `${formatDegrees(limits.pitchMaxRad)} down`,
        zeroLabel: "0° level",
        maxLabel: `${formatDegrees(limits.pitchMinRad)} up`,
        hint: adjustmentHint(message.rpyCalib[1], "pitch"),
        reverseAxis: true,
        secondary: true,
      })}
      ${renderToleranceRow("Yaw", message.rpyCalib[2], limits.yawMinRad, limits.yawMaxRad, {
        minLabel: `${formatDegrees(limits.yawMaxRad)} left`,
        zeroLabel: "0° center",
        maxLabel: `${formatDegrees(limits.yawMinRad)} right`,
        hint: adjustmentHint(message.rpyCalib[2], "yaw"),
        reverseAxis: true,
        motion: renderYawMotionVisual(message.rpyCalib[2], limitKey),
      })}
    </section>
  `;
}

function renderToleranceRow(
  label: string,
  value: number,
  min: number,
  max: number,
  axisLabels: { minLabel: string; zeroLabel: string; maxLabel: string; hint: string; reverseAxis?: boolean; secondary?: boolean; motion?: string },
): string {
  const rawPercent = ((value - min) / (max - min)) * 100;
  const axisPercent = axisLabels.reverseAxis ? 100 - rawPercent : rawPercent;
  const rawZeroPercent = ((0 - min) / (max - min)) * 100;
  const axisZeroPercent = axisLabels.reverseAxis ? 100 - rawZeroPercent : rawZeroPercent;
  const markerPercent = Math.min(100, Math.max(0, axisPercent));
  const zeroPercent = Math.min(100, Math.max(0, axisZeroPercent));
  const inside = value > min && value < max;
  const rowClass = axisLabels.secondary ? "tolerance-row is-secondary" : "tolerance-row";
  return `
    <div class="${rowClass}">
      <div class="tolerance-row-header">
        <strong>${label}</strong>
        <span class="${inside ? "inside" : "outside"}">${formatAngle(value)} ${inside ? "inside" : "outside"}</span>
      </div>
      <div class="tolerance-track" aria-label="${label} tolerance ${formatDegrees(min)} to ${formatDegrees(max)}, value ${formatAngle(value)}">
        <span class="tolerance-zero" style="left: ${zeroPercent}%"></span>
        <span class="tolerance-marker" style="left: ${markerPercent}%"></span>
      </div>
      <div class="tolerance-axis">
        <span>${axisLabels.minLabel}</span>
        <span class="tolerance-zero-label" style="left: ${zeroPercent}%">${axisLabels.zeroLabel}</span>
        <span>${axisLabels.maxLabel}</span>
      </div>
      <p class="tolerance-hint">${axisLabels.hint}</p>
      ${axisLabels.motion ?? ""}
    </div>
  `;
}

function renderYawMotionVisual(yaw: number, limitKey: keyof typeof CALIBRATION_LIMITS): string {
  const direction = yawMotionDirection(yaw);
  const deviceShape = limitKey === "mici" ? "c4" : "c3";
  const directionText = direction === "center" ? "Yaw is near 0°; no outward rotation needed." : `Rotate outward ${direction}.`;
  const ariaLabel = `Yaw motion guidance for ${CALIBRATION_LIMITS[limitKey].label}. ${directionText}`;
  return renderYawMotionSvg(deviceShape, direction, ariaLabel);
}

function yawMotionDirection(yaw: number): "left" | "right" | "center" {
  if (Math.abs(yaw) < 0.0001) return "center";
  return yaw > 0 ? "left" : "right";
}

function renderYawMotionSvg(deviceShape: "c3" | "c4", direction: "left" | "right" | "center", ariaLabel: string): string {
  return deviceShape === "c4" ? renderC4YawMotionSvg(direction, ariaLabel) : renderC3YawMotionSvg(direction, ariaLabel);
}

function renderC3YawMotionSvg(direction: "left" | "right" | "center", ariaLabel: string): string {
  return `
    <svg class="motion-svg motion-c3 motion-${direction}" viewBox="0 0 520 300" role="img" aria-label="${ariaLabel}" focusable="false">
      <path class="motion-centerline" d="M260 88V270"></path>
      ${renderC3YawMotionArrow(direction)}
      <g class="motion-device">
        ${renderYawAnimation(direction, 17, 260, 178)}
        <rect class="motion-device-body" x="140" y="154" width="240" height="48" rx="14"></rect>
        <path class="motion-device-nose" d="M260 126L286 158H234Z"></path>
        <circle class="motion-device-camera" cx="260" cy="178" r="12"></circle>
      </g>
    </svg>
  `;
}

function renderC4YawMotionSvg(direction: "left" | "right" | "center", ariaLabel: string): string {
  return `
    <svg class="motion-svg motion-c4 motion-${direction}" viewBox="0 0 360 250" role="img" aria-label="${ariaLabel}" focusable="false">
      <path class="motion-centerline" d="M180 58V226"></path>
      ${renderC4YawMotionArrow(direction)}
      <g class="motion-device">
        ${renderYawAnimation(direction, 16, 180, 164)}
        <rect class="motion-device-body" x="140" y="124" width="80" height="80" rx="13"></rect>
        <path class="motion-device-nose" d="M180 94L204 126H156Z"></path>
        <circle class="motion-device-camera" cx="180" cy="164" r="11"></circle>
      </g>
    </svg>
  `;
}

function renderYawAnimation(direction: "left" | "right" | "center", degrees: number, cx: number, cy: number): string {
  if (direction === "center") return "";
  const startAngle = direction === "left" ? degrees : -degrees;
  return `<animateTransform attributeName="transform" type="rotate" values="${startAngle} ${cx} ${cy}; 0 ${cx} ${cy}; 0 ${cx} ${cy}; ${startAngle} ${cx} ${cy}; ${startAngle} ${cx} ${cy}" keyTimes="0; 0.44; 0.82; 0.8201; 1" dur="2.2s" repeatCount="indefinite"></animateTransform>`;
}

function renderC3YawMotionArrow(direction: "left" | "right" | "center"): string {
  if (direction === "center") return `<path class="motion-settled" d="M218 128H302"></path>`;
  if (direction === "left") {
    return `
      <path class="motion-arc" d="M360 128C325 72 205 72 160 128"></path>
      <path class="motion-arrowhead" d="M146 142L186 128L156 98Z"></path>
    `;
  }
  return `
    <path class="motion-arc" d="M160 128C195 72 315 72 360 128"></path>
    <path class="motion-arrowhead" d="M374 142L334 128L364 98Z"></path>
  `;
}

function renderC4YawMotionArrow(direction: "left" | "right" | "center"): string {
  if (direction === "center") return `<path class="motion-settled" d="M146 92H214"></path>`;
  if (direction === "left") {
    return `
      <path class="motion-arc" d="M248 92C222 48 140 48 112 92"></path>
      <path class="motion-arrowhead" d="M102 104L134 92L108 68Z"></path>
    `;
  }
  return `
    <path class="motion-arc" d="M112 92C138 48 220 48 248 92"></path>
    <path class="motion-arrowhead" d="M258 104L226 92L252 68Z"></path>
  `;
}

function adjustmentHint(value: number, axis: "pitch" | "yaw"): string {
  if (Math.abs(value) < 0.0001) return "Already near 0°.";
  if (axis === "pitch") {
    return value > 0 ? "To get closer to 0°, aim the device more up." : "To get closer to 0°, aim the device more down.";
  }
  return value > 0 ? "To get closer to 0°, aim the device outward more to the left." : "To get closer to 0°, aim the device outward more to the right.";
}

function renderPreviousValid(previous: NonNullable<CalibrationScanResult["previousValid"]>, routeInfo: CalibrationScanResult["routeInfo"]): string {
  const message = previous.message;
  const roll = message.rpyCalib[0];
  const pitch = message.rpyCalib[1];
  const yaw = message.rpyCalib[2];
  return `
    <section class="previous-valid">
      <h3>Previous valid calibration</h3>
      <dl class="result-list compact">
        <div><dt>Segment</dt><dd>${previous.segment}</dd></div>
        <div><dt>Status</dt><dd>${message.statusName} (${message.calPerc}% complete, ${message.validBlocks} valid blocks)</dd></div>
        <div><dt>Roll / pitch / yaw</dt><dd>${formatAngle(roll)} / ${formatAngle(pitch)} / ${formatAngle(yaw)}</dd></div>
        <div><dt>Log mono time</dt><dd>${formatLogMonoTime(message.logMonoTime)}</dd></div>
      </dl>
      ${renderToleranceVisualization(message, routeInfo, "Previous valid landing")}
    </section>
  `;
}

function renderReadFailures(result: CalibrationScanResult): string {
  return `
    <section class="scan-warning">
      <h3>Unreadable ${logFileKind(result.logSource)} segment(s)</h3>
      <p class="muted">These segments could not be checked, so the full scan is incomplete.</p>
      <ul>
        ${result.readFailures
          .map(
            (failure) =>
              `<li>Segment ${failure.segment}: ${escapeHtml(failure.message)}</li>`,
          )
          .join("")}
      </ul>
    </section>
  `;
}

function renderQcameraPreview(result: CalibrationScanResult): string {
  if (!result.qcameraPreview) return "";
  return `
    <section class="qcamera-preview" id="qcamera-preview" data-preview-url="${escapeHtml(result.qcameraPreview.logUrl)}">
      <div class="qcamera-preview-header">
        <h3>optional qcamera preview</h3>
        <span>${previewCaption(result)}</span>
      </div>
      <div class="qcamera-frame" id="qcamera-frame">Loading first frame...</div>
    </section>
  `;
}

async function loadQcameraPreview(result: CalibrationScanResult, generation: number): Promise<void> {
  const preview = result.qcameraPreview;
  if (!preview) return;
  const frame = document.querySelector<HTMLElement>("#qcamera-frame");
  if (!frame) return;

  try {
    const { captureFirstQcameraFrame } = await import("./qcameraPreview");
    const captured = await captureFirstQcameraFrame(preview.logUrl);
    if (generation !== renderGeneration) return;
    frame.innerHTML = `
      <img src="${captured.dataUrl}" alt="${escapeHtml(previewCaption(result))}" width="${captured.width}" height="${captured.height}" />
      <p>${Math.ceil(captured.bytesFetched / 1024)} KiB fetched</p>
    `;
  } catch (error) {
    if (generation !== renderGeneration) return;
    frame.classList.add("unavailable");
    const detail = error instanceof Error ? error.message : String(error);
    frame.innerHTML = `
      <p>qcamera preview unavailable. Calibration scan result is unaffected.</p>
      <p class="qcamera-preview-detail">${escapeHtml(detail)}</p>
    `;
  }
}

function previewCaption(result: CalibrationScanResult): string {
  const preview = result.qcameraPreview;
  if (!preview) return "";
  if (preview.reason === "invalid-segment") return `first frame from invalid segment ${preview.segment}`;
  if (preview.reason === "unreadable-segment") return `first frame from unreadable segment ${preview.segment}`;
  return `first frame from segment ${preview.segment}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return copyTextWithSelectionFallback(value);
  }
}

function showCopyFeedback(button: HTMLButtonElement, copied: boolean): void {
  const original = button.textContent ?? "Copy";
  button.textContent = copied ? "Copied" : "Copy failed";
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
    if (button === shareButton) setShareButtonState();
  }, 1200);
}

function copyTextWithSelectionFallback(value: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);

  const selection = document.getSelection();
  const selectedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  textarea.remove();
  if (selectedRange && selection) {
    selection.removeAllRanges();
    selection.addRange(selectedRange);
  }
  return copied;
}
