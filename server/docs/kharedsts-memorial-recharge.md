# Old Memorial book recharging

The Old Memorial inscription now continues into recharge menus for a carried or equipped Book of the Dead, or Kharedst's memoirs with at least one attached page. This uses the existing account charge balance and teleport consumer. It does not implement page attachment or claim complete Kourend parity.

## Sources

- [OSRS Wiki: Book of the dead](https://oldschool.runescape.wiki/w/Book_of_the_dead): Old Memorial, one law/body/mind/soul rune per charge, 10 base Magic XP and 250 maximum charges.
- [OSRS Wiki: Kharedst's memoirs](https://oldschool.runescape.wiki/w/Kharedst%27s_memoirs): at least one page, 20 capacity per attached page up to 100, and rune pouch support.
- Local RSProx **231/00363**: inscription at tick 2189, Continue opens recharge/Do nothing at 2191, option 1 at 2198 leads to the missing-runes message at 2199. Tick 2490 shows 32/250 with Add 1/5/10/218/Do nothing. The earlier inscription-only interpretation missed the continuation.
- Active cache **242**: `kourendwoodland_statue` 31714 exists on the real map at 1520,3478; `messagebox:continue` is 229:4. The historical capture uses different component numbers. Native tests resolve the active component and assert its pause flags.

No supplied capture shows successful recharge text, animation or tick duration, or full-book wording. No extra success/full message or animation has been invented. Menus offer 1, 5, 10 and remaining capacity; submission bounds the actual addition by current capacity and the least available rune supply.

## State and production path

Native OPLOC1 resolves the actual map object in `ObjectActionPacketListener`; `KourendWoodland.inspectMemorial` shows the inscription. Native Continue advances `ActionDialogue` into `continueMemorial`, closes that chain and emits `kharedst:memorial-inspected`.

`KourendTravelItems.inspectMemorialForRecharge` prioritizes a held Book over memoirs and retains the selected Item reference and player location. `MultiChatboxPrompt` owns native 219:1 resumes and removes a pending callback before invoking it. Quantity selection rechecks registered/alive/location/book identity, current charges, capacity and rune totals. Closing or replacing the chatbox invalidates its callback.

`rechargeMemorial` validates all four costs synchronously, spends carried-pouch shortfalls through `rune-pouch:supply`, deletes inventory portions, then calls the existing `setMemoirCharges` and `SkillManager` XP policy. Pouch supply requires an actually carried usable pouch and excludes an inaccessible saved fourth slot with an ordinary pouch. It never queries staff/infinite spell sources. Inventory/Equipment refreshes publish the resulting balance; `PlayerSave` persists the existing charge/page-marker attributes and normal skills/items. Inspecting lower-cap memoirs does not rewrite excess shared Book charges.

## Verification on 2026-11-16

- RED: native mapped Inspect + Continue produced no recharge menu on unchanged plugins (2 pass, 1 fail). The regression remains in `tests/kharedsts-memorial-recharge.test.cjs`.
- Focused command, from `server`: `node --test tests/kharedsts-memorial-recharge.test.cjs tests/kharedsts-memoirs-read-check.test.cjs tests/kourend-travel-finish-diary.test.cjs tests/rune-pouch.test.cjs tests/kourend-woodland-old-memorial.test.cjs` — **67 passed**. Real Player, Inventory, Equipment, map/native packets, Bank transfer and PlayerSave; only network and dialogue capture stubbed. No full suite.
- A separate reviewer traced the unchanged container, prompt, pouch, XP and save owners. Their three adversarial real-object checks plus existing pouch consumers passed **35/35**: replace a live pouch rune, merge inventory runes before submission, close/reopen, and both books/shared balance/save. No gameplay findings in the inspected paths. They found the author's historical Continue component verification gap; it was reproduced and corrected to active-cache resolution/flags. Only the affected recharge suite was rerun: **13/13 passed**.
- Root prepared matching server `tsc --build` before the runtime JavaScript changes. No changed TypeScript or redundant server rebuild. The existing world-config docs generator was run after updating the plugin description.

## Live native input and persistence

Exclusive slot 13 used an anonymous fixture with a **seeded** Book, 20 of each cost rune, and developer placement at 1520,3477. Browser and server both loaded cache 242. Browser login used the fixture credentials; interactions used canvas mouse events through the existing client hit-testing/input pipeline, not direct recharge callbacks.

The actual memorial silhouette/Inspect tooltip was hit and clicked, then the rendered Continue, Recharge and Add 5 controls. Charges went **0 to 5**, each inventory rune **20 to 15**, and Magic XP **0 to 50**. Native inventory context Check displayed **5/250**. Reopening the quantity menu and clicking Do nothing preserved 15 of each rune and 50 XP. A real server logout/relogin reloaded the disk save and Check still displayed 5/250, with the same runes and XP.

A further live server-MCP check seeded a divine pouch, used each real rune stack on it, and selected Add 1 through native packet tools. Charges became **6**, Magic XP **60**, and all four pouch quantities **15 to 14**, with no cost runes in inventory. Read-only SQLite inspection after logout confirmed the persisted six-charge attribute and four 14-rune pouch slots. This additional pouch check was not a rendered mouse walkthrough.

### Rendering limit

Both the default WebGPU client and its existing `?renderer=webgl` option retained a black terrain scene and Loading overlay. WebGL reported nine maps, scene ready, and no pending/invalid/failed map loads. Minimap, inventory, memorial interaction outline/tooltip and all relevant dialogue controls rendered. Native menu/hit-test behavior and the screenshots below were inspected; **full scene colour/terrain appearance remains unverified**. This was not reproduced against clean base, so it is not classified as an unrelated baseline defect. No client source was changed.

Screenshots retain this limitation visibly:

- [Native memorial Inspect](../../docs/screenshots/memorial-recharge/native-inspect-webgl.jpg)
- [Native quantity choices](../../docs/screenshots/memorial-recharge/quantity-menu.jpg)
- [Charged book Check](../../docs/screenshots/memorial-recharge/check-five.jpg)

The fixture was logged out/saved before stopping the owned server/client sessions. The own browser tab closed, both retained launcher sessions ended on Ctrl+C, and all assigned listeners (3113, 43713, 49813, 43913, 49613) were absent afterwards. The launcher did not emit a graceful-shutdown completion line; logout completion and the saved database state were checked independently. No other services, NPC spawns or generated game data were changed.
