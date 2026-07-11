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

JWTs entered in the private-route panel are persisted in that browser's local
storage and verified against comma's `/v1/me/` endpoint when saved and restored.
Rejected tokens are removed; temporary verification failures leave the local
token intact so an API outage does not destroy credentials.

## Browser and video requirements

openpilot uploads driver video as raw HEVC/H.265. This app downloads only the
keyframe-aligned byte ranges needed for the selected clip and remuxes those
encoded bytes into fragmented MP4 in memory. It does not transcode the video.

Your browser, operating system, and hardware must therefore provide native HEVC
decoding. The app checks this before loading video
and leaves telemetry usable when video is unsupported. There is intentionally no
large WebAssembly decoder or server transcoding fallback in the first version.

Driver camera recording must have been enabled on the device. Driver-camera
footage is sensitive: check what is visible before sharing your screen or route.

## Using the debugger

1. Open the drive in [comma Connect](https://connect.comma.ai/).
2. Under **More info**, enable **Public access**, or use the JWT option in this
   app for a private route.
3. Paste the Connect URL. URLs ending in `/start/end` load that clip range; a
   bare route URL defaults to the first 30 seconds.

Accepted inputs include:

```text
<dongle-id>|<route-id>
https://connect.comma.ai/<dongle-id>/<route-id>
https://connect.comma.ai/<dongle-id>/<route-id>/90/120
```

The parser supports both the legacy flat Driver Monitoring state and the modern
policy-based state (`visionPolicyState` and `wheeltouchPolicyState`).

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
