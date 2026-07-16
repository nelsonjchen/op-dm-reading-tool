import { expect, test } from "@playwright/test";

const modernRoute = process.env.COMMA_TEST_ROUTE;
const commaJwt = process.env.COMMA_JWT;
const liveTest = modernRoute && commaJwt ? test : test.skip;
const routeBase = modernRoute?.replace(/\/\d+(?:\.\d+)?\/\d+(?:\.\d+)?\/?$/, "");
const PUBLIC_MICI_ROUTE = "https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496";
const PUBLIC_MICI_STRESS_CLIPS = [
  { start: 247, end: 276, seek: 270 },
  { start: 355, end: 375, seek: 372 },
  { start: 600, end: 625, seek: 621 },
];

test.beforeEach(async ({ page }) => {
  if (!commaJwt) return;
  await page.addInitScript((token) => {
    localStorage.setItem("ai.comma.api.authorization", token);
  }, commaJwt);
});

liveTest("remuxes and plays the private modern driver-camera clip", async ({ page }) => {
  await page.goto(`/?route=${encodeURIComponent(modernRoute!)}`);
  const video = page.locator("#driver-video");
  await expect(page.locator("#status-text")).toHaveText("Driver Monitoring debugger ready");
  await expect(video).toHaveJSProperty("videoWidth", 1928);
  await expect(video).toHaveJSProperty("videoHeight", 1208);
  await expect(video).toHaveJSProperty("readyState", 4);
  await expect(video).toHaveJSProperty("controls", false);
  await expect(page.locator("#playback-toggle")).toBeEnabled();
  await expect(page.locator("#awareness")).toContainText("%");
  await expect(page.locator("#driver-box")).toBeVisible();

  await page.locator("#playback-toggle").click();
  await expect(page.locator("#playback-toggle")).toHaveText("Pause");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(1);
  await expect.poll(async () => Number(await page.locator("#route-scrubber").inputValue())).toBeGreaterThan(1);
});

liveTest("starts an interior clip on a complete keyframe", async ({ page }) => {
  const interiorClip = `${routeBase}/90/95`;
  await page.goto(`/?route=${encodeURIComponent(interiorClip)}`);
  await expect(page.locator("#status-text")).toHaveText("Driver Monitoring debugger ready");
  const video = page.locator("#driver-video");
  await expect(video).toHaveJSProperty("readyState", 4);
  await expect(page.locator("#route-clock")).toHaveText("1:30.0");
  await video.evaluate(async (element: HTMLVideoElement) => element.play());
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(1);
});

liveTest("loads high-resolution DM telemetry from the rlog", async ({ page }) => {
  await page.goto("/");
  await page.locator("#high-resolution-telemetry").check();
  await page.locator("#route-input").fill(modernRoute!);
  await page.locator("#load-button").click();
  await expect(page.locator(".route-meta")).toContainText("rlogs · 20 Hz");
  await expect(page.locator("#status-text")).toHaveText("Driver Monitoring debugger ready");
  await expect(page.locator("#driver-video")).toHaveJSProperty("readyState", 4);
});

liveTest("restores and verifies a persisted comma JWT", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#auth-panel")).toContainText("Verified with comma");
  await page.reload();
  await expect(page.locator("#auth-panel")).toContainText("Authenticated to comma with a saved JWT");
  await expect(page.locator("#auth-panel")).toContainText("Verified with comma");
});

test("scans Connect warning segments with the qlog worker pool", async ({ page }) => {
  await page.goto(`/?route=${encodeURIComponent(PUBLIC_MICI_ROUTE)}`);
  await expect(page.locator(".scan-list")).toContainText("Orange system warning");
  await expect(page.locator("#status-text")).toContainText("Scan complete", { timeout: 90_000 });
  await expect(page.locator(".scan-count")).toContainText("16/16");

  const firstOrange = page.locator(".scan-result.severity-warning").filter({ hasText: "10:44.2" });
  await expect(firstOrange).toHaveCount(1);
  await firstOrange.click();
  await expect(page.locator("#status-text")).toHaveText("Driver Monitoring debugger ready");
  await expect(page.locator("#route-clock")).toHaveText("10:36.0");
  await expect(page.locator("#driver-video")).toHaveJSProperty("readyState", 4);
});

test("seeks and plays across public Mici clips without poisoning SourceBuffer", async ({ page }) => {
  test.setTimeout(120_000);
  for (const clip of PUBLIC_MICI_STRESS_CLIPS) {
    const url = `${PUBLIC_MICI_ROUTE}/${clip.start}/${clip.end}`;
    await page.goto(`/?route=${encodeURIComponent(url)}`);
    await expect(page.locator("#status-text")).toHaveText("Driver Monitoring debugger ready");
    const video = page.locator("#driver-video");
    await expect(video).toHaveJSProperty("readyState", 4);

    await page.locator("#route-scrubber").fill(String(clip.seek));
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(clip.seek - clip.start - 1);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.buffered.length ? element.buffered.end(0) : 0)).toBeGreaterThan(clip.seek - clip.start);
    await expect(video).toHaveJSProperty("error", null);
    await expect(page.locator("#status-text")).toHaveText("Driver Monitoring debugger ready");

    const beforePlay = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await page.locator("#playback-toggle").click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(beforePlay + 0.5);
    await expect(video).toHaveJSProperty("error", null);
    await page.locator("#playback-toggle").click();
  }
});

test("opens and advances a route-time deep link", async ({ page }) => {
  const clip = `${PUBLIC_MICI_ROUTE}/247/276`;
  await page.goto(`/?route=${encodeURIComponent(clip)}&t=270`);
  await expect(page.locator("#status-text")).toHaveText("Driver Monitoring debugger ready");
  await expect(page.locator("#route-clock")).toHaveText("4:30.0");
  await expect(page.locator("#route-scrubber")).toHaveValue("270");
  await expect(page).toHaveURL(/[?&]t=270(?:&|$)/);

  await page.locator("#playback-toggle").click();
  await expect.poll(() => Number(new URL(page.url()).searchParams.get("t"))).toBeGreaterThan(270);
});

test("keeps the submitted route in the address bar while driver video is missing", async ({ page }) => {
  const clip = `${PUBLIC_MICI_ROUTE}/247/276`;
  await page.route("https://api.comma.ai/v1/route/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/files")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          qlogs: ["https://example.test/5beb9b58bd12b691/0000010a--a51155e496/3/qlog.zst"],
          dcameras: [],
        },
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { fullname: "5beb9b58bd12b691|0000010a--a51155e496" },
    });
  });

  await page.goto("/");
  await page.locator("#route-input").fill(clip);
  await page.locator("#load-button").click();

  await expect(page.locator(".missing-video")).toContainText("Driver video is not uploaded");
  await expect(page).toHaveURL(new RegExp(`route=${encodeURIComponent(clip)}`));
});

test("loads the public Mici demo from the route form", async ({ page }) => {
  const demo = `${PUBLIC_MICI_ROUTE}/438/452`;
  await page.goto("/");
  await page.locator("#demo-button").click();
  await expect(page.locator("#route-input")).toHaveValue(demo);
  await expect(page.locator("#status-text")).toHaveText("Driver Monitoring debugger ready");
  const driverBox = page.locator("#driver-box");
  await expect(driverBox).toBeVisible();
  await expect(page.locator("#route-clock")).toHaveText("7:26.0");
  await expect(page.locator("#model-values")).toContainText("87%");
  await expect(page.locator(".model-input-frame")).toHaveCSS("border-top-width", "2px");
  await expect.poll(() => page.locator(".model-input-frame").evaluate((element) => getComputedStyle(element, "::before").content)).toBe('"MODEL INPUT"');
  await expect(page.locator("#route-scrubber")).toHaveAttribute("style", /#e08546/);
  await expect(page.locator(".transport-legend")).toContainText("Distraction signal / warning");
  await expect(page.locator(".transport-note")).toContainText("did not escalate them to an on-device warning or failure");
  await expect(page.locator(".timeline-alert-marker")).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]t=446(?:&|$)/);
  await expect(page).toHaveURL(new RegExp(`route=${encodeURIComponent(demo)}`));
  await driverBox.hover();
  await expect(driverBox).toHaveCSS("opacity", "0.12");
  await driverBox.click();
  await page.locator("#route-clock").hover();
  await expect(driverBox).toHaveClass(/peek/);
  await expect(driverBox).toHaveCSS("opacity", "0.12");
  await driverBox.click();
  await page.locator("#route-clock").hover();
  await expect(driverBox).not.toHaveClass(/peek/);
  await expect(driverBox).toHaveCSS("opacity", "1");
  await page.locator("#route-scrubber").fill("447");
  await expect(page.locator("#route-clock")).toHaveText("7:27.0");

  await page.setViewportSize({ width: 390, height: 844 });
  const telemetryCards = await page.locator(".debug-card").evaluateAll((cards) => cards.map((card) => {
    const bounds = card.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, width: bounds.width };
  }));
  expect(telemetryCards).toHaveLength(3);
  expect(telemetryCards[1].top).toBeGreaterThanOrEqual(telemetryCards[0].bottom);
  expect(telemetryCards[2].top).toBeGreaterThanOrEqual(telemetryCards[1].bottom);
  expect(telemetryCards[1].width).toBe(telemetryCards[0].width);
  await expect(page.locator("#model-values dd").first()).toHaveCSS("overflow-wrap", "normal");
});
