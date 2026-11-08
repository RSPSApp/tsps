# Verification lessons

Use [the testing guide](../../../../server/docs/agents/testing.md) for current MCP tools.
Supply only setup irrelevant to the reported boundary; then trigger ordinary gameplay.
Record supplied placement/gear separately from acquisition or progression proof.

## Common false positives

| Boundary | What the check must establish |
| --- | --- |
| Packet submission | “Sent” is queued. Advance player ticks; assert final stage, inventory, message and encoded world changes. |
| Onboarding | Complete normal appearance/None selection; never clear guards. Cache-241 None is widget 890:21. After restart, an existing account may instead need Welcome 378's Play action. |
| Combat fixture | Clear real placement/registration first. `can_attack`, `canCast` or queued spells do not prove damage/XP; retain first target-reset failure. |
| Item/reward bug | Exercise the actual quest/reward producer. Admin item-add and stale generated flags can hide native-cache hydration or slot-replacement defects. |
| Diary completion | Prove acquisition and the real activity, not only supplied-item hand-in. Reset ordered progress only when `diary:task` sets `completed === true`. |
| Weapon overrides | Test real registry order and preserve `overridesWeapon`; direct resolver tests can miss a higher-priority resolver masking quests. |
| Ground pickup | Inspect cache size/rotation/clipping and test a reachable side; a table tile need not itself be walkable. Don't move source objects to make a check pass. |
| Timing | Compare packet tick, relative client-cycle fields and rendered frames before changing scheduling. One-tick-later callbacks may already align with delayed movement. |

## Diagonal doors — #3618 / PR #3661

- Reach to the **current** leaf does not make its **next** tile safe. Clear only
  the clicking actor if a shape-9 leaf would move onto them; leave bystanders alone.
- Preserve the pre-route approach side relative to the **closed doorway** anchor
  and normal. The rotated open leaf is the wrong plane; a fixed reference-server
  step can push both approaches onto one side.
- Check normal movement collision, including diagonal corners. Try bounded
  same-side alternatives when the usual step hits a wall; if none is safe,
  leave the door, sound and tracked state unchanged. Do not construct a private
  replacement object before deciding: construction can itself register it.
- Verify both closing flanks × four orientations, opening overlap × four,
  and actual reported doorway passage in both directions. Rotated QA fixtures
  alone missed Ardougne's building wall; preserve failed fixtures and restore QA data.
- Keep the proven cache transforms. rsmod/OpenRune/Lost City supply a reference
  pattern, not verified OSRS timing; disclose missing retail capture/visual proof.

## Client investigations

- Identify browser versus external RuneLite and renderer/device first; a RuneLite
  sidebar or “GPU on/off” is insufficient. Prove boot and inspect page exceptions
  before a long scenario; after suspension recheck the process/page.
- Use the latest verified `scripts/wt`: old copied dependency self-links can resolve
  a second React. Inspect resolution before reinstalling; restore any temporary alias.
- GPU defaults: trace `client/runelite/client/plugins/index.ts`, plugins, then
  `client/render/render/misc.ts` and `webgpu/frameConfig.ts`. Distinguish device
  defaults from saved intent through disable/re-enable/reload. Test Reset and an
  explicitly saved sky colour equal to the environment in both renderers.
- GE keyboard: follow GrandExchange.plugin.js → MobileChatKeyboard.ts →
  OsrsClient.onCanvasTouchTap. Cache-241 script 750 uses meslayer 162:44 inside
  162:39 and hides toggle 162:43. Test the logged-in buy/search path, not login.
- Trusted touch differs from asynchronous server focus. Use a negative control;
  emulated DOM focus/settings do not prove physical iPhone keyboard or 3D pixels.
- Bind screenshots to unobscured final sessions. Preserve rejected captures.
  Visual fixes need rendered proof; server-only MCP is appropriate for gameplay.
- Keep exact command/tree/exit/log evidence, totals and skips. An empty compiler
  log can be valid; retain successful completion and emitted-output hashes.
  Rerun only changed relevant inputs or missing proof. Docs edits need strict VitePress build.
