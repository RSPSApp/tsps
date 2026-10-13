# RuneLite client performance checks — 13 October 2026

The benchmark found repeated global graphics scans in the core hooks and full-canvas uploads for bounded plugin overlays. The first PR now indexes native actor/map graphics and supports damaged-region texture uploads; the adapter PR supplies the previous/current overlay damage. Ordinary gameplay remains near the 60 FPS cap in these checks.

## Sources and method

- Main baseline: `1abe6807960229277a6a89deb286d9782eb06642`. Its `client/` files match latest main `af16c8a4488f6a04089bd3d51d3844794a925e64`; intervening changes affect server code/data/tests and documentation.
- Core before fix: `9820ba9e5ef310eadb0696fe98e4f66cf1c73b57`. Fixed native implementation: `54347b3294d064bbab233290edcf2b90b185c471`. Adapter damage caller: `f422d497f5318d27bccf2895c105bd94e184845b`.
- Apple M5 Pro; Node v24.18.0 for native microbenchmarks. Fresh isolated Chrome profiles, Apple GPU adapter, HD disabled and map radius 1.
- Chrome window 1280 × 800; effective viewport 1280 × 713, game canvas 1234 × 713. Cap 60 FPS; Lumbridge tile 3208,3215,0; camera starts at yaw 1024/pitch 300 and rotates at 80 units/second in rotation trials.
- Each browser window lasts 10 seconds after warm-up. Creator UI cases retain the modal and are separate from normal gameplay. Validated WebGL and core/stack normal WebGPU cases assert the tile and absent creator; the first normal main WebGPU case predates that explicit assertion.
- Render/tick timings measure synchronous JavaScript calls, including CPU submission cost, not asynchronous GPU execution. Nested widget time must not be added to its parent render time.
- Browser cases ran sequentially; native microbenchmarks and builds were scheduled outside the normal-gameplay capture windows. General background activity, animated NPCs and JIT variability remain; sequential short trials cannot prove a broad speedup.
- Heap checks used collection outside sample windows. They measure short-term retained JavaScript heap, not process memory, peak allocations or long-term leaks.

## Browser results

Weighted render means are in ms/frame. The p95 column is a range of per-window values, not a pooled p95. WebGPU and WebGL are compared separately. The earlier unvalidated main WebGL capture is excluded.

| Scenario/backend | Revision | Mode | 10 s windows | Render mean | Render p95 range | Observed FPS |
|---|---|---|---:|---:|---:|---:|
| Creator UI / WebGPU | main | idle | 3 | 1.626 | 2.250–2.445 | 60.06 |
| Creator UI / WebGPU | main | rotate | 3 | 4.405 | 5.025–5.340 | 60.02 |
| Creator UI / WebGPU | core before | idle | 3 | 1.594 | 2.130–2.385 | 60.08 |
| Creator UI / WebGPU | core before | rotate | 3 | 3.948 | 4.335–4.695 | 60.09 |
| Normal / WebGPU | main | idle | 2 | 2.568 | 3.045–3.555 | 60.09 |
| Normal / WebGPU | main | rotate | 2 | 4.041 | 4.485–4.555 | 60.09 |
| Normal / WebGPU | core before | idle | 2 | 1.751 | 2.330–2.570 | 60.03 |
| Normal / WebGPU | core before | rotate | 2 | 2.546 | 2.900–3.275 | 60.09 |
| Normal / WebGPU | stack before | idle | 2 | 2.488 | 2.925–3.295 | 60.13 |
| Normal / WebGPU | stack before | rotate | 2 | 3.919 | 4.470–4.510 | 60.09 |
| Normal / WebGPU | stack after | idle | 2 | 1.820 | 2.550–2.835 | 60.13 |
| Normal / WebGL | main validated | idle | 1 | 1.449 | 1.640–1.640 | 60.18 |
| Normal / WebGL | main validated | rotate | 1 | 2.693 | 3.005–3.005 | 60.17 |
| Normal / WebGL | core before | idle | 1 | 1.622 | 2.565–2.565 | 60.09 |
| Normal / WebGL | core before | rotate | 1 | 3.010 | 3.460–3.460 | 60.09 |
| Normal / WebGL | core after | idle | 1 | 1.463 | 1.900–1.900 | 60.09 |
| Normal / WebGL | core after | rotate | 1 | 2.672 | 2.975–2.975 | 60.08 |
| Normal + FPS overlay / WebGPU | stack before | idle | 2 | 3.236 | 3.790–3.960 | 59.99 |
| Normal + FPS overlay / WebGPU | stack after | idle | 2 | 2.196 | 2.995–3.240 | 59.98 |

No full widget redraws or browser long tasks were recorded in the baseline/core/default-stack windows. Clean FPS-overlay windows also used partial redraws. Core after fix is close to validated main WebGL: 1.463 versus 1.449 ms idle and 2.672 versus 2.693 ms rotating. The cap means lower CPU time does not establish higher FPS.

## Native graphics hot path

Nine timed samples after warm-up, using native spawns; setup is excluded from expiration timings. These synthetic batch medians are separate from gameplay frame times. The final column uses the actual committed `fixed` variant, not the temporary candidate.

| Case | Actors/players | Main (ms/batch) | Core before (ms/batch) | Fixed core (ms/batch) |
|---|---:|---:|---:|---:|
| expire attached graphics (no subscribers) | 256 | 0.00581 | 0.06001 | 0.01995 |
| expire attached graphics (no subscribers) | 1024 | 0.01601 | 0.80775 | 0.09365 |
| expire attached graphics (with subscriber) | 1024 | — | 0.77456 | 0.08177 |
| spawn attached graphics (explicit slot) | 256 | 0.19725 | 0.15692 | 0.01862 |
| spawn attached graphics (explicit slot) | 1024 | 1.57562 | 1.49692 | 0.07687 |
| per-frame player graphics map query (3 graphics/player) | 64 | 0.06653 | 0.06858 | 0.00366 |
| per-frame player graphics map query (3 graphics/player) | 256 | 1.08079 | 1.08259 | 0.02193 |

The event hook scanned all remaining graphics for each expired actor graphic, making bulk expiration quadratic. Per-actor indexes remove repeated global scans and improve existing main map-query/explicit-slot replacement paths. Main has no corresponding subscriber hook. Fixed no-subscriber expiration still includes per-graphic bookkeeping absent from main; this is not a claim that every synthetic case equals main.

## Bounded overlays and validation

- Before: FPS uploads selected the complete 1234 × 713 source canvas, 879,842 pixels/call. After: the actual WebGL probe recorded 601 partial uploads, zero full uploads, selecting 1234 × 15 (18,510 pixels/call): **97.9% fewer selected pixels per call**. Initial allocation/resizes intentionally remain full uploads.
- These are actual API argument regions, not measured RAM/GPU bus bytes or hardware bandwidth. The pre-fix synchronous upload total was 27.72 ms/600 calls; asynchronous GPU time remains unmeasured.
- Clean FPS render CPU averaged 3.236 → 2.196 ms, but default stack CPU also changed 2.488 → 1.820 ms. Scene/JIT/background variation and native changes prevent attributing the entire difference to partial uploads.
- Real WebGL readback passed five 64-pixel cases: initial orientation, cropped source/unchanged surroundings, transparent erasure, negative-edge clipping and offscreen no-op. Every case returned `NO_ERROR` with unpack skips reset. FPS screenshots verified visible text and clean removal.
- Same-size texture updates use WebGL2 TexImageSource subrect selection through unpack skips and explicit dimensions, as specified by [Khronos](https://registry.khronos.org/webgl/specs/latest/2.0/#PIXEL_STORE_PARAMETERS_FOR_UPLOADS_FROM_TEXIMAGESOURCE). Mocked regressions also cover resize, upload failure cleanup and moved/removed/reactivated overlay damage.
- Local validation passed: 10 focused core suites, 33 focused stack suites and both client typechecks.

## Remaining limits

- Adapter events still post without subscribers. The post-fix default 10-second probe counted 8,940 MenuEntryAdded, 2,688 PostMenuSort, 500 ClientTick, 500 PostClientTick and 600 BeforeRender events. Counts establish unnecessary work, not a proven ordinary-gameplay frame regression.
- Widget/item draw hooks still require a complete widget-tree pass; painting overlays without bounds require full-layer damage. Active overlay canvases still clear/render each frame.
- No crowded combat, low-end hardware, uncapped FPS, asynchronous GPU timer, peak/long-term memory or exhaustive plugin/quest benchmark was performed.

Canonical raw browser paths are recorded in `/tmp/runelite-browser-perf-summary.json`, including validated main WebGL and both post-fix captures. Native before rows are in `/tmp/tsps-core-perf-after.json`; committed fixed rows are in `/tmp/tsps-core-perf-committed.json`.
