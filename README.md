# openpilot driver monitoring debugger

An all-client-side web debugger for openpilot Driver Monitoring. Paste a comma
Connect route or clip URL to replay uploaded driver-camera video alongside the
state that openpilot used to decide whether the driver was attentive.

The UI is based on the `driver-debug` renderer in
[op-replay-clipper](https://github.com/nelsonjchen/op-replay-clipper): it shows
awareness, distraction reasons, alerts, face and eye probabilities, phone and
sunglasses probabilities, pose/calibration values, and coarse driver/other-seat
boxes over the synchronized camera feed.

Everything runs in the browser. Route logs, video, and JWTs are not uploaded to
this project or a project-owned backend.

## Try the public Mici demo

[![The public Mici demo loaded in the openpilot driver monitoring debugger, with the driver's face highlighted](https://opdm.mindflakes.com/og-preview.png?v=demo-route)](https://opdm.mindflakes.com/?route=https%3A%2F%2Fconnect.comma.ai%2F5beb9b58bd12b691%2F0000010a--a51155e496%2F438%2F452&t=446)

Open the clip directly in the
[driver monitoring debugger](https://opdm.mindflakes.com/?route=https%3A%2F%2Fconnect.comma.ai%2F5beb9b58bd12b691%2F0000010a--a51155e496%2F438%2F452&t=446),
or inspect the original public route in
[comma Connect](https://connect.comma.ai/5beb9b58bd12b691/0000010a--a51155e496/438/452).

This is a stable public Mici fixture with uploaded driver-camera video, so it is
useful for trying playback, face highlighting, telemetry, and seeking without a
JWT. It records the older flat Driver Monitoring state. Modern openpilot routes
use policy-based Driver Monitoring fields and can show additional state; the
debugger supports both formats. The **Try demo** button in the route form opens
this clip directly at an 87% phone-model probability around route second 446.
The peak is a useful perturbed Driver Monitoring signal, not a confirmed
distraction alert.

The **Authenticate to comma with a JWT** panel explains that JWT authentication
opens private routes and, for device owners, permits missing-file upload
requests. JWTs are persisted in that browser's local storage and verified
against comma's `/v1/me/` endpoint when saved and restored.
Tokens can be created at [jwt.comma.ai](https://jwt.comma.ai). Public routes do
not require authentication.
Rejected tokens are removed; temporary verification failures leave the local
token intact so an API outage does not destroy credentials.

## Browser and video requirements

openpilot uploads driver video as raw HEVC/H.265. This app downloads only the
keyframe-aligned byte ranges needed for the selected clip and remuxes those
encoded bytes into fragmented MP4 in memory. It does not transcode the video.
Video loading begins automatically after clip telemetry renders. The player
downloads keyframe-aligned ranges incrementally, appends remuxed MP4 fragments
through Media Source Extensions, and keeps a small buffer ahead of playback.
The full clip is not assembled into one large in-memory blob before playback.

Your browser, operating system, and hardware must therefore provide native HEVC
decoding. The app checks this before loading video
and leaves telemetry usable when video is unsupported. There is intentionally no
large WebAssembly decoder or server transcoding fallback in the first version.

Driver camera recording must have been enabled on the device. Driver-camera
footage is sensitive: check what is visible before sharing your screen or route.

If a clip's driver video has not uploaded yet, an owner JWT can request only the
missing `dcamera.hevc` segments from the device. The app queues the request
through comma Athena, watches until the files appear, and then opens the clip.
Offline requests wait for the device to reconnect; uploads are Wi-Fi-only.

## Using the debugger

1. Open the drive in [comma Connect](https://connect.comma.ai/).
2. Under **More info**, enable **Public access**, or authenticate to comma with
   a JWT in this app for a private route.
3. Paste the Connect URL. URLs ending in `/start/end` load that clip range. A
   bare route scans its Connect warning timeline and qlogs, prioritizing orange
   and red intervals before the rest of the drive.

Playback and scrubbing update a `t=<route-second>` query parameter at most once
per second. The **Share** button copies that timestamped URL, and opening it
restores the same point in the route. For example, a shared URL for the 247–276
second clip with `t=270` opens at route second 270.

Accepted inputs include:

```text
<dongle-id>|<route-id>
https://connect.comma.ai/<dongle-id>/<route-id>
https://connect.comma.ai/<dongle-id>/<route-id>/90/120
```

The parser supports both the earlier flat Driver Monitoring state and the modern
policy-based state (`visionPolicyState` and `wheeltouchPolicyState`).

For clip views, the app reports the route's openpilot version and recording
date. When the route commit exists in commaai/openpilot, it also looks up when
the Driver Monitoring model artifact was last changed at that commit. The logs
do not include a standalone DM model name or hash, so the app labels this as
provenance instead of guessing a model generation.

Route scans fetch each segment's small `events.json` first, then use a bounded
two-worker pool to download, decompress, and decode qlogs in warning-first
order. Results appear progressively, and starting another route cancels the
previous scan. Selecting a result loads a padded video clip around that event.

For fast browsing, the app uses qlogs by default (roughly 2 Hz DM telemetry).
Enable **High-resolution DM telemetry** to prefer an available rlog and inspect
the model and monitoring state at roughly 20 Hz. Rlogs are much larger because
the full overlapping 60-second log segment must be downloaded and decompressed.

## Local development

The repository uses pnpm through Corepack:

```sh
corepack enable
pnpm install
pnpm dev
```

Useful checks:

```sh
pnpm test
pnpm build
pnpm test:smoke
```

The normal unit suite is deterministic and offline. Live smoke and browser tests
read `COMMA_TEST_ROUTE` and `COMMA_JWT` from `.env.local`; copy `.env.example`
and fill those values locally. Both tests skip the private modern fixture when
the variables are absent.

## Deployment

The app is a static Vite site. For Cloudflare Pages, use `pnpm build` and publish
`dist`. No server-side function is required, and secrets must never be added as
`VITE_` variables because those are exposed to browser code.

## How the streaming path works

Each qlog contains `driverEncodeIdx` records with encoded frame lengths,
keyframe flags, timestamps, segment numbers, and presentation/encode order. The
app uses those records to bound HTTP Range requests, starts at the preceding
keyframe, continuously parses Annex-B NAL units across the index boundaries, and
builds GOP-fragmented MP4 in memory without re-encoding. Network reads are capped
at roughly 2 MiB each. The selected clip's remuxed MP4 remains in memory during
playback, so short Connect clip URLs are preferable to very long ranges.

## Privacy and limitations

- JWTs are stored only in the current browser, as in the original route tool.
- Face boxes are coarse model-derived anchors, not face detections or privacy
  redaction.
- This is diagnostic tooling, not a replacement for openpilot's safety checks.
- Live route smoke tests can fail when external comma services are unavailable;
  they are kept separate from required offline tests.
- `pnpm test:browser` is the native-codec end-to-end loop. It uses system Chrome
  and an encrypted private-route fixture on the scheduled/manual macOS CI job.
