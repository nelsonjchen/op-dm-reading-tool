# openpilot invalid calibration scanner

A small all-client-side web app that scans a public openpilot route for invalid
`liveCalibration` messages.

It fetches comma's public route file list, downloads qlogs first when available,
falls back to rlogs, supports `.zst` and `.bz2`, decompresses in the browser, and
decodes just enough Cap'n Proto to read calibration values. If it finds invalid
calibration, it reports that message plus the valid calibration seen immediately
before it when available. If no invalid calibration is found, it reports the
earliest valid calibration as an all-clear.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

## Deploy on Cloudflare Pages

Use these settings:

- Build command: `npm run build`
- Build output directory: `dist`
- Node version: current LTS or newer

No server-side function is required.

## Deploy on GitHub Pages

This repo includes a GitHub Actions workflow at `.github/workflows/pages.yml`.
Pushes to `main` build the app and deploy `dist` to GitHub Pages.

For the `ophwug/op-calibration-reading-tool` project page, the app is built
with the Vite base path `/op-calibration-reading-tool/`, so the expected URL is:

```text
https://ophwug.github.io/op-calibration-reading-tool/
```

## Getting a usable route

1. Open [comma Connect](https://connect.comma.ai/) and select the drive.
2. Open **More info** and turn on **Public access**.
3. Use the Connect file controls to upload logs if they are missing.
4. Copy either the browser URL or the route name.

Accepted inputs look like:

```text
5beb9b58bd12b691|0000010a--a51155e496
https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496/90/105
```

You can turn Public access off again after reading the route.

## Current calibration tolerances

As of the current openpilot `master` code checked on 2026-05-13, calibration is
considered valid after at least 5 valid calibration blocks and when pitch/yaw are
inside:

- Most devices: pitch `-5.20°` to `9.74°`, yaw `-3.96°` to `3.96°`
- mici / comma four: pitch `-8.20°` to `12.74°`, yaw `-3.96°` to `3.96°`

The openpilot device settings text rounds the common case to within `4°`
left/right and within `5°` up or `9°` down.

## Useful commands

```sh
npm test
npm run test:smoke
npm run build
```

`test:smoke` uses the public demo route from `op-replay-clipper`, so it needs
network access.
