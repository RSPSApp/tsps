# Settings wheel ownership and camera controls

1. Reproduce the native IF3 wheel path in focused tests. A `noScrollThrough` widget currently exits before its own scroll listener and before consuming the delta, letting the camera see it. Preserve normal viewport zoom and listener-only transparent widgets.
2. Route wheel input to the foreground widget's listener first, then consume scroll blockers. Keep cache scripts responsible for native scrollbar movement and thumb synchronization. Verify the settings path with cache data when available.
3. Add a compact, toggleable Controls overlay through the existing client configuration manager. Show actual normal and close-camera bindings, including Backquote (the key above Tab) to enter/exit, Tab focus cycling, and an explicit Exit close camera button. Expose an idempotent close-camera exit method; do not remap existing keys.
4. Run focused wheel, first-person, controls rendering, typecheck and build checks. Commit this input/UI change separately from utility plugins. Root owns registry integration and final live-world validation.

Investigation found a second wheel ownership defect: hit tests were reused solely by pointer coordinates, even after opening a modal at a stationary pointer. Wheel frames now repick the live widget tree. The installed cache's Settings group 134/list 14 does have a valid scrollbar listener; native verification runs its real onLoad and wheel scripts, proving content and thumb movement plus camera suppression at the scroll boundary. No generic scrollbar replacement is needed.

The DOM plugin sidebar is a sibling of the game canvas. InputManager's wheel listener is attached only to that canvas, so ordinary DOM panel scroll events do not enter the native camera pipeline. The existing close-camera toggle is Backquote, the physical key above Tab; Tab cycles focus while that mode is active. The guide documents this distinction and preserves all existing bindings.

Validation commands from `client`:
- `node_modules/.bin/tsx tests/settings-wheel-controls.test.ts`
- `node_modules/.bin/tsx tests/settings-wheel-native-cache.test.ts` (uses the installed offline cache)
- `node_modules/.bin/tsx tests/first-person-reticle-input.test.ts`
- `node_modules/.bin/tsx tests/camera-plugin.test.ts`
- `node_modules/.bin/tsc --noEmit -p tsconfig.json`
- `node ../scripts/run-with-env.mjs production ./node_modules/@craco/craco/dist/bin/craco.js build`
