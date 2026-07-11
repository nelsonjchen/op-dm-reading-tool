import { expect, test } from "@playwright/test";

const modernRoute = process.env.COMMA_TEST_ROUTE;
const commaJwt = process.env.COMMA_JWT;
const liveTest = modernRoute && commaJwt ? test : test.skip;
const routeBase = modernRoute?.replace(/\/\d+(?:\.\d+)?\/\d+(?:\.\d+)?\/?$/, "");

test.beforeEach(async ({ page }) => {
  if (!commaJwt) return;
  await page.addInitScript((token) => {
    localStorage.setItem("ai.comma.api.authorization", token);
  }, commaJwt);
});

liveTest("remuxes and plays the private modern driver-camera clip", async ({ page }) => {
  await page.goto(`/?route=${encodeURIComponent(modernRoute!)}`);
  await expect(page.locator("#status-text")).toHaveText("Driver Monitoring debugger ready");
  const video = page.locator("#driver-video");
  await expect(video).toHaveJSProperty("videoWidth", 1928);
  await expect(video).toHaveJSProperty("videoHeight", 1208);
  await expect(video).toHaveJSProperty("readyState", 4);
  await expect(page.locator("#awareness")).toContainText("%");
  await expect(page.locator("#driver-box")).toBeVisible();

  await video.evaluate(async (element: HTMLVideoElement) => element.play());
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
  await expect(page.locator("#status-text")).toHaveText("Driver Monitoring debugger ready");
  await expect(page.locator(".route-meta")).toContainText("rlogs · 20 Hz");
  await expect(page.locator("#driver-video")).toHaveJSProperty("readyState", 4);
});

liveTest("restores and verifies a persisted comma JWT", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#auth-panel")).toContainText("Verified with comma");
  await page.reload();
  await expect(page.locator("#auth-panel")).toContainText("JWT persisted in this browser");
  await expect(page.locator("#auth-panel")).toContainText("Verified with comma");
});
