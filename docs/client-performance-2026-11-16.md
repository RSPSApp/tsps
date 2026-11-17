# Client performance: frame time and garbage — 16 November 2026

A CPU, GPU and allocation audit of the web client on `origin/main` 08966b742, and what this
branch (`perf/client-frame-time-gc`) changes. Measured on one Windows PC in headless Chrome
with the WebGPU renderer and production builds; CPU throttling is a stress case, not a phone.
Follows [client-performance-2026-11-01.md](client-performance-2026-11-01.md) (#1760).

## What was wrong

- **Every frame was a full HUD repaint again** (729 full, 0 partial in 8 s). `WidgetsOverlay.draw`
  forced a full pass whenever a `drawBeforeMenu` overlay existed and anything was dirty. That rule
  came with Item Rarity (off by default); the RuneLite `TooltipOverlay` (Mouse Tooltips) and Rune
  Pouch now use the flag and are on by default, and the minimap is dirty every frame, so the
  partial passes from #1760 never ran. The full pass was 3–5.6 ms of a 4.4–7.4 ms desktop frame
  and 23 ms of a 35 ms frame at 4× throttle, half of all JS allocation, and a ~6.5 MB
  WebGL→2D-canvas copy per frame.
- **The minimap repainted every frame** even with nothing moving, and each repaint reset four
  sampler parameters on every tile, icon and the mask (~615 `texParameteri` a frame) and
  re-uploaded the same frame uniforms per draw.
- **Player cache keys used BigInt arithmetic.** `PlayerAppearance.getHash` allocated a heap
  BigInt per operation; `getCacheKey` ran twice per player per frame. 29% of all allocation with
  150 players in view.
- Smaller per-frame garbage: a `BigInt64Array(0)` per cs2 script frame (~1,400 timer scripts a
  second), a new `Set`, a closure and a `join` per ambient-sound emitter every frame, spreads and
  maps per overhead-prayer entry, `Object.keys` per actor update.
- The WebGPU scene's depth attachment was written back every frame with nothing reading it.

## What changed

- Before-menu overlays take part in partial passes: drawn again in each dirty rect, scissored to
  it. Anchored overlays (Status Bars) likewise draw once per dirty rect at their anchor inside
  the tree (review finding: once per pass lost the second bar when a pass cleared both). Each
  overlay layer keeps its own rects, rebuilt into `widgetOverlayRects` at the end of every pass.
- The minimap redraws when a hash of what it shows changes (player, plane, yaw, zoom, flag, player
  and NPC dots, ground-item version), and at least every 200 ms (plugins treat minimap geometry
  older than 500 ms as stale; it also catches tile images finishing loading). On a boat or with
  a hint arrow it redraws every frame as before. Sampler parameters are set once per texture and
  frame uniforms once per `begin()`.
- The appearance hash is the same ×31 fold on two 32-bit lanes; the key is computed once per
  player per frame.
- Shared empty long-locals array, reused ambient key set and cached sound keys, reused
  overhead-prayer array, stats reset without `Object.keys`.
- Depth is discarded after the world pass unless a scene extension (HD) is active.

## Results

Production builds of `origin/main` and this branch alternated main → fix → main → fix on the same
account and scene, mean of two 8-second windows each. Render CPU is main-thread time per frame.

| Scene / mode | Render CPU mean (ms) | p95 (ms) | HUD (ms) | Allocation (MB/s) | GC (ms/s) |
| --- | --- | --- | --- | --- | --- |
| Desktop idle | 4.43 → 1.88 | 5.06 → 2.38 | 3.12 → 0.69 | 85.2 → 22.3 | 17.0 → 9.5 |
| Desktop camera drag | 4.41 → 2.05 | 4.99 → 2.38 | 3.08 → 0.86 | 83.8 → 23.9 | 14.1 → 7.2 |
| 150 players idle | 5.74 → 2.65 | 7.66 → 3.59 | 3.56 → 0.71 | 138.2 → 43.7 | 23.5 → 14.8 |
| 150 players drag | 5.27 → 2.75 | 6.11 → 3.22 | 3.12 → 0.91 | 117.2 → 44.0 | 18.2 → 13.3 |
| Mobile 4× throttle, 150 players, idle | 30.4 → 13.6 | 41.1 → 24.0 | 18.9 → 3.3 | 36.8 → 20.0 | 21.3 → 16.1 |
| Mobile 4× throttle, 150 players, drag | 29.1 → 13.6 | 38.5 → 24.2 | 17.7 → 3.5 | 38.7 → 20.2 | 22.4 → 18.0 |

Full HUD repaints in 8 s went from 730–742 (desktop) and 155–201 (mobile) to 0; WebGL calls on
the HUD context from ~2,300 to ~430–640 a frame on desktop, with no `texParameteri` left; the
HUD canvas copy from ~6.3 MB to ~0.2 MB a frame. Mobile fps (capped at 30) went from ~25 to
29.5. World-pass GPU time was unchanged within noise on this PC.

## Checking it

- Unit tests: `widget-overlay-before-menu-partial`, `minimap-redraw` (gate and signature),
  `minimap-dot-batching` (GL state), `player-appearance-hash`, plus every existing client test
  that imports a changed module.
- In game: after partial passes (idle, a RuneLite tooltip held over the redrawing minimap, a walk)
  the presented HUD canvas was compared with a forced full repaint. The only differences were dots
  that moved between the two snapshots; the tooltip stayed whole on top and left nothing behind
  when removed.

## Left for later

- A tooltip that follows the mouse still forces full passes (its overlay has no `coverage()`).
- The right-click menu forces a full pass every frame it is open.
- On WebGPU the HUD is a WebGL2 canvas copied into a 2D canvas the browser composites over the
  WebGPU canvas; drawing it in the WebGPU screen pass would remove a copy and a layer.
- `computeWidgetRoots` lays out every root every frame; `getGameContext()` and
  `prepareWidgetEntry` allocate per frame; `WebGPUMapSquare.drawBatches` builds closures and
  descriptors per bundle; type loaders touch their LRU with `Map.delete`+`set` on every hit;
  RuneLite config accessors re-read storage on every call.
- `withSeqHandItems` builds an appearance without `colorTextureOverrides`, `compositionItems` or
  `firstPersonArmsOnly` (a recoloured item may lose its recolour during such a sequence; not
  verified in game).
