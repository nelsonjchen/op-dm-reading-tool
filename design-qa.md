# Timeline design QA

## Source visual truth

- `/var/folders/0y/dykynjfd6hb0rg77dzjnyz7m0000gn/T/codex-clipboard-2872a120-8711-42b2-85eb-ec11732b6414.png` — 2474 × 454 px Connect drive view.
- `/var/folders/0y/dykynjfd6hb0rg77dzjnyz7m0000gn/T/codex-clipboard-c467c369-60a9-4a9f-84d2-72c1005eb892.png` — 513 × 320 px focused timeline crop.
- `commaai/connect` reference: `src/components/Timeline/index.jsx` and `src/components/Timeline/thumbnails.jsx`, read from the public `master` branch.

## Implementation evidence

- URL: `http://localhost:5174/#how-to-use`
- Screenshot: `/Users/nelson/code/op-dm-reading-tool/design-qa-implementation.png`
- Screenshot dimensions: 882 × 860 px at the browser's default viewport and device scale.
- Timeline guide DOM dimensions: 863 × 261 CSS px.
- State: default instructional page, timeline guide visible, no route loaded.
- The focused source crop and the implementation screenshot were reviewed together. The source is a tighter crop than the implementation because the implementation intentionally retains the instructional heading, directions, and step cards around the demo.

## Findings

- Fonts and typography: the existing page type system remains consistent; the compact timeline metadata and hover pill use the same small UI scale as the source.
- Spacing and layout: the demo now uses the Connect layering and proportions—12 px status strip, 20 px thumbnail row, 44 px ruler, plus the hover-time pill below the ruler. Desktop and 540 px mobile captures do not overlap or clip the guide.
- Colors and visual tokens: driving blue, engaged green, yellow bookmark, dark blue-gray ruler, translucent remaining overlay, and neutral drag selection map closely to the Connect source and its public timeline implementation.
- Image quality and asset fidelity: the thumbnail row uses real public Mici route `sprite.jpg` frames from the referenced route rather than placeholder CSS texture.
- Copy and content: the existing instructions still explain the press/drag/release sequence and the rendered guide makes those steps legible.
- Icons: the guide uses a small MDI cursor icon from Iconify at the selection edge; it has sufficient contrast and a restrained shadow so it reads as an instructional pointer rather than Connect chrome.
- States and interactions: the cursor now loops through a press-and-drag gesture, with a `prefers-reduced-motion` fallback; the actual route input and replay controls remain unchanged and functional.

## Comparison history

1. Initial visual pass added the Connect-style status, thumbnail, ruler, selection, and hover layers. A small segment-number label collided with the guide heading.
2. Removed that label and recaptured `/Users/nelson/code/op-dm-reading-tool/design-qa-implementation.png`. The focused comparison now has no actionable P0/P1/P2 visual findings.
3. Added the cursor animation and removed the full-height playhead line so the selection handles stay inside the ruler, matching Connect's layer boundaries.

## Implementation checklist

- [x] Match Connect timeline layer order and heights.
- [x] Use real route thumbnail imagery.
- [x] Match status, bookmark, ruler overlay, drag selection, and hover pill styling.
- [x] Add a visible cursor affordance at the drag edge.
- [x] Animate the press-and-drag cue with reduced-motion support.
- [x] Verify desktop and 540 px mobile layouts.
- [x] Check browser console for errors.
- [x] Run TypeScript build and tests.

## Follow-up polish

- The guide is intentionally a static visual explainer; making its drag gesture update live would be a separate interaction enhancement.

final result: passed
