import "./styles.css";
import { CALIBRATION_LIMITS, GITHUB_REPO_URL, OPENPILOT_MASTER_SOURCES } from "./constants";
import { formatAngle, formatDegrees, formatLogMonoTime, pitchDirection, yawDirection, deviceLimitKey } from "./format";
import { scanRouteForFirstValidCalibration, scanRouteForInvalidCalibration, type CalibrationScanResult } from "./scan";

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
          placeholder="https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496/90/105" />
        <button class="scan-button" type="submit" name="scan-mode" value="quick">Quick look</button>
        <button class="scan-button secondary" type="submit" name="scan-mode" value="full">Full scan</button>
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
          <li>Copy either the browser URL or the route name. A current URL looks like <code>https://connect.comma.ai/&lt;dongle&gt;/&lt;route&gt;/&lt;start&gt;/&lt;end&gt;</code>.</li>
          <li>You can turn Public access off again after reading the route.</li>
        </ol>
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
const demoButton = document.querySelector<HTMLButtonElement>("#demo-button")!;
const statusText = document.querySelector<HTMLParagraphElement>("#status-text")!;
const progressBar = document.querySelector<HTMLDivElement>("#progress-bar")!;
const resultPanel = document.querySelector<HTMLElement>("#result-panel")!;

demoButton.addEventListener("click", () => {
  input.value = "https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496/90/105";
  input.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter instanceof HTMLButtonElement ? event.submitter : null;
  const mode = submitter?.value === "full" ? "full" : "quick";
  setBusy(true);
  clearResult();

  try {
    const scanner = mode === "full" ? scanRouteForInvalidCalibration : scanRouteForFirstValidCalibration;
    const result = await scanner(input.value, (progress) => {
      statusText.textContent = progress.message;
      if (progress.total && progress.current) {
        progressBar.style.width = `${Math.max(5, (progress.current / progress.total) * 100)}%`;
      } else {
        progressBar.style.width = progress.phase === "done" ? "100%" : "8%";
      }
    });
    renderResult(result);
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : String(error);
    progressBar.style.width = "100%";
    progressBar.classList.add("error");
  } finally {
    setBusy(false);
  }
});

function setBusy(busy: boolean): void {
  for (const button of scanButtons) {
    button.disabled = busy;
  }
  demoButton.disabled = busy;
  input.disabled = busy;
  progressBar.classList.toggle("error", false);
  if (busy) progressBar.style.width = "4%";
}

function clearResult(): void {
  resultPanel.hidden = true;
  resultPanel.innerHTML = "";
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
  const isFullAllClear = result.scanMode === "full" && result.resultType === "valid";
  const isQuick = result.scanMode === "quick";
  const resultEyebrow = isQuick ? "quick calibration look" : isFullAllClear ? "route calibration all clear" : "earliest invalid calibration";
  const resultBadge = isQuick
    ? "first valid calibration"
    : isFullAllClear
      ? "no invalid calibration found"
      : result.reason === "status-invalid"
        ? "logged invalid"
        : "outside current limits";
  const resultBadgeClass = isInvalid ? "warn" : "ok";
  const segmentText = isFullAllClear
    ? `${result.totalSegments} ${logFileKind(result.logSource)} segment(s), earliest valid calibration in segment ${result.segment}`
    : isQuick
      ? `${result.segment} after scanning ${result.scannedSegments} ${logFileKind(result.logSource)} segment(s)`
    : `${result.segment} after scanning ${result.scannedSegments} ${logFileKind(result.logSource)} segment(s)`;
  const toleranceMarkup = renderToleranceVisualization(message, result.routeInfo, "Tolerance landing");
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
    ${toleranceMarkup}
    ${previousValidMarkup}
  `;
}

function logFileKind(source: CalibrationScanResult["logSource"]): "qlog" | "rlog" {
  return source === "qlogs" ? "qlog" : "rlog";
}

function renderToleranceVisualization(message: NonNullable<CalibrationScanResult["message"]>, routeInfo: CalibrationScanResult["routeInfo"], title: string): string {
  const limits = CALIBRATION_LIMITS[deviceLimitKey(routeInfo)];
  return `
    <section class="tolerance-visual">
      <h3>${title}</h3>
      ${renderToleranceRow("Pitch", message.rpyCalib[1], limits.pitchMinRad, limits.pitchMaxRad)}
      ${renderToleranceRow("Yaw", message.rpyCalib[2], limits.yawMinRad, limits.yawMaxRad)}
    </section>
  `;
}

function renderToleranceRow(label: string, value: number, min: number, max: number): string {
  const rawPercent = ((value - min) / (max - min)) * 100;
  const markerPercent = Math.min(100, Math.max(0, rawPercent));
  const inside = value > min && value < max;
  return `
    <div class="tolerance-row">
      <div class="tolerance-row-header">
        <strong>${label}</strong>
        <span class="${inside ? "inside" : "outside"}">${formatAngle(value)} ${inside ? "inside" : "outside"}</span>
      </div>
      <div class="tolerance-track" aria-label="${label} tolerance ${formatDegrees(min)} to ${formatDegrees(max)}, value ${formatAngle(value)}">
        <span class="tolerance-marker" style="left: ${markerPercent}%"></span>
      </div>
      <div class="tolerance-axis">
        <span>${formatDegrees(min)}</span>
        <span>${formatDegrees(max)}</span>
      </div>
    </div>
  `;
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
