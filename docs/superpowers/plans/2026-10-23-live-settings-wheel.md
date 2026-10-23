# Revised live Settings wheel investigation

The initial wheel fix did not solve the user's wrench → All Settings case. Do not infer success from a standalone cache widget.

1. Start only this worktree's isolated slot 3 world/client (3103/43703), leaving the user's world and other agents' ports untouched. Open an isolated browser page and log in with a disposable test account.
2. Open All Settings through the actual in-game wrench and server modal chain. Record scrollY, current input pointer/hit roots, camera position/zoom, view mode and incoming wheel routing before/after wheel events.
3. Follow the observed path to its first incorrect ownership decision, add a failing regression reproducing that full boundary, then fix only the input/control files. Cover standard and close-camera modes where relevant.
4. Rebuild the candidate and repeat the real modal interaction in the browser. Require observable list movement without camera movement, including the bottom boundary and return to normal world zoom after closing Settings.
5. Run focused regressions/typecheck/build, save evidence, commit separately, and shut down only this task's isolated services.

## Root cause and native evidence

The WebGPU 117 HD renderer captured raw wheel into `followCamWheel` before `handleInput` dispatched native widgets. Its camera rectangle includes the Settings modal's area, so even a correctly consumed list gesture still changed the HD follow-camera zoom. HD now receives only the original delta accepted by viewport script 39, after UI dispatch. UI-hidden unclaimed world input still works; close camera cannot accumulate an HD delta.

Live isolated browser, disposable WheelProbe account, WebGPU, root 161 and server-opened modal 134 via wrench/All Settings:

- Before fix, HD off: list 0→45 and camera unchanged.
- Before fix, HD on: list 45→90, HD target 1→1.1972173631218102, camera position changed.
- After HD fix, HD on: list 0→45, target 1→1, camera position exactly unchanged.
- Bottom test: 74 wheel frames reached scrollY 3311; an extra wheel remained clamped at 3311. Target 0.6505114555849587 and camera position stayed exactly unchanged throughout.
- After native Close: no modal remained, world wheel changed target 0.6505114555849587→0.7788036095359547 and moved the camera as expected.

A second live close-camera defect remained: after a mousemove and wheel, list 0→45; another wheel at the same physical point without mousemove stayed at 45. Keyboard selection parked `mouseX/Y` on its focused control between events. Unlocked wheel events now refresh their canvas coordinates from the event itself, while pointer-locked world input retains its aim point.

## Final rebuilt browser verification

Build `main.ee80c022.js` / `199.5f071cbe.chunk.js`, own isolated slot 3, 117 HD enabled:

- Close camera: three wheel events with no mousemove scrolled 0→45→90→135. HD zoom target, close-camera view zoom and camera position were exactly unchanged.
- Clicked the actual Controls overlay's Exit close camera button. Standard HD mode wheel scrolled 135→180 with identical camera position and target 1.
- Seventy more wheel frames reached maximum 3311; another wheel stayed at 3311 with identical camera position and target 1.
- Closed Settings through its native Close action. No modal remained. World wheel changed HD target 1→1.1972173631218102 and moved the camera normally.

Structured live evidence is in `docs/superpowers/evidence/2026-10-23-settings-wheel-slot3.json`. Focused settings wheel, native cache Settings, first-person, camera, WebGPU render ordering and HD camera tests pass. Typecheck and changed-source ESLint pass; production build passes with existing unrelated warnings. The regression now exercises the actual WebGPU render ordering, not just a standalone cache list.

## User-directed controls placement

Hide the entire Controls section outside close-camera mode. In close-camera mode, show a compact bottom-centred strip with the expand/collapse and exit buttons. The guide expands upward so those buttons remain at the edge. Keep the saved expansion preference and default collapsed state. Verify inactive/active rendering, production build and a native screenshot in isolated slot 3; no input or renderer behavior changes.

Native screenshot confirmed the collapsed strip is 196.73×34.80 CSS pixels, centred exactly, eight pixels above the bottom edge. Final build `main.071f0e38.js` reports zero Controls elements in standard view and one collapsed strip within the existing 250 ms HUD refresh after close-camera activation. Mode visibility is refreshed independently of changes in the FPS number. Expansion keeps the heading anchored to the bottom; Exit hides the entire section again. Render-condition regression, typecheck, changed UI ESLint and production build pass (existing unrelated build warnings only).
