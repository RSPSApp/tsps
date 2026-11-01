# Client performance: HUD redraws — 1 November 2026

Issue #1760 reports the mobile client as "severely" under-optimised without naming a device or
a screen. Profiling the mobile layout found that every HUD repaint was a **full** repaint of the
whole widget tree, on desktop as well as on phones, and that the Ground Items plugin reformatted
every label every frame. This branch makes those repaints partial. Everything below was measured
on one Windows PC in headless Chrome; CPU throttling is a stress case, not a phone.

## What was wrong

- `WidgetManager.updateMinimap` marks the minimap widget dirty every frame (its dots move), so
  the HUD redraws at the frame rate (desktop) or the low-end cap of ~25 Hz (phones).
- `WidgetsOverlay.draw` forced a **full** pass whenever any widget was dirty while a
  below-widget overlay existed. The Ground Items plugin (on by default) is one, so a dirty minimap
  repainted the whole HUD: 205 full redraws and zero partial ones in an 8-second idle window.
- Any overlay whose `signature()` changed also forced a full pass. Ground item labels move with
  the camera and the player, so walking or turning repainted the whole HUD every frame.
- `GroundItemsOverlay.build()` ran every frame and formatted each label (`toLocaleString`) anew.
- `GameContainer` kept the FPS readout in React state and re-rendered the whole game tree four
  times a second for it.

## What changed

- A changed overlay redraws only where it was and where it will be, through an optional
  `WidgetOverlay.coverage()`; one that cannot say still redraws everything. Ground items implement
  it from the frame its signature built, measured with the font of its last draw.
- A partial pass with below-widget overlays clears the dirty rects, redraws those overlays
  scissored to each rect, then the widgets on top, as before. `planWidgetOverlayRedraw` holds the
  decision and has a unit test.
- Ground item labels are cached per item (mode, quantity and prices checked) and a built frame is
  drawn without rebuilding; the overlay's own rects are shared by `draw()` and `coverage()`.
- The FPS counter writes its element directly. NPC pose context keys are rebuilt only when an
  input changes.

## Method

Production builds of `main` (`d2080687c`) and this branch, each served by
`client/scripts/serve-build.mjs` against the same worktree game server, the same account and
the same spawn position, run back to back. The driver was a local script, not kept in the repo:
headless Chrome, Android user agent, touch and DPR 3 at 844×390 (desktop: no emulation, DPR 1,
1280×800), WebGPU, the default plugin set with Ground Items on, 10 seconds of settling, then an
idle window and a camera-drag window (512 yaw units/s) of 8 seconds each, with a 200 µs sampling
profile and timers around the render call, the HUD draw and the actor/overlay/UI updates. The 4×
case uses Chrome's CPU throttle.

Render CPU is the synchronous main-thread time of one frame's render call; GPU time is not
measured. The machine was not quiet for every capture (see limits), so the pairs below are the
ones taken back to back under the same load.

## Results

### Mobile layout, 4× CPU throttle (the phone-like case)

| Metric | Idle main | Idle branch | Drag main | Drag branch |
| --- | ---: | ---: | ---: | ---: |
| FPS | 60.6 | 67.8 | 55.0 | 65.4 |
| Render CPU mean | 12.17 ms | 8.17 ms | 13.70 ms | 9.69 ms |
| Render CPU p95 / p99 | 27.8 / 44.7 ms | 17.6 / 22.8 ms | 34.1 / 50.9 ms | 19.4 / 24.8 ms |
| Frame interval p95 | 26.8 ms | 26.7 ms | 40.1 ms | 26.7 ms |
| Frames over 25 ms / 50 ms | 92 / 12 | 57 / 4 | 110 / 21 | 73 / 2 |
| HUD draw per frame | 6.13 ms | 1.57 ms | 6.89 ms | 1.89 ms |
| Full / partial HUD redraws | 205 / 0 | 0 / 2 | 202 / 0 | 0 / 4 |

An earlier pair under heavier background load went 17.7 → 40.3 FPS idle and 13.7 → 42.3 FPS
dragging (render CPU mean 37.7 → 15.6 ms and 38.2 → 16.8 ms), with 102 → 11 frames over 50 ms.
Its absolute numbers are not comparable with the table; the direction and the HUD share are.

### Mobile layout, native CPU

| Metric | Idle main | Idle branch | Drag main | Drag branch |
| --- | ---: | ---: | ---: | ---: |
| FPS (75 Hz headless ceiling) | 75.1 | 75.0 | 75.1 | 75.1 |
| Render CPU mean | 3.49 ms | 2.63 ms | 3.38 ms | 2.75 ms |
| Render CPU p95 / p99 | 7.28 / 9.75 ms | 4.33 / 5.97 ms | 7.20 / 8.13 ms | 4.58 / 5.85 ms |
| HUD draw per frame | 1.35 ms | 0.43 ms | 1.27 ms | 0.44 ms |
| Full / partial HUD redraws | 205 / 0 | 0 / 4 | 208 / 0 | 0 / 2 |

### Desktop layout, native CPU

| Metric | Idle main | Idle branch | Drag main | Drag branch |
| --- | ---: | ---: | ---: | ---: |
| Render CPU mean | 3.17 ms | 2.13 ms | 3.11 ms | 2.12 ms |
| Render CPU p95 / p99 | 3.73 / 4.74 ms | 3.20 / 4.26 ms | 3.70 / 4.96 ms | 3.07 / 3.95 ms |
| HUD draw per frame | 1.97 ms | 0.84 ms | 1.93 ms | 0.89 ms |
| Full / partial HUD redraws | 716 / 0 | 0 / 12 | 721 / 0 | 0 / 12 |

Desktop has no HUD rate cap, so main repainted the whole HUD on every one of its ~720 frames.

## Validation

- `cd client && npx tsc --noEmit -p tsconfig.json` — clean.
- New `tests/widget-overlay-partial-redraw.test.ts`; `tests/ground-items-plugin.test.ts` extended
  with coverage and label-cache checks; the full client suite run is recorded in the PR.
- A screenshot after a drag window on the branch shows the mobile HUD intact over the scene
  (no label ghosting), but no label happened to be on screen in that scene.

## Limits and what is left

- One PC, headless Chrome, its own GPU: no physical phone, no GPU timing, no battery.
- Background load varied between captures; only back-to-back pairs are compared.
- Still on the render thread, in this order at 4×: cs2 widget `onTimer` scripts (about 1,800 runs
  a second, OSRS parity), actor packing and pose keys, `computeWidgetRoots` laying out every root
  every frame, `getCanvasCssSize` several times a frame, ambient sound gain scheduling while the
  AudioContext is suspended. An open context menu still repaints the HUD fully every frame.
- The report's "clipping and interface bugs" are not addressed here: no device or screen was
  named.
