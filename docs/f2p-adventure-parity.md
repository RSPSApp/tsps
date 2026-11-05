# Ernest the Chicken and Dragon Slayer I

Source: revision240 RSProx recordings in the Discord [F2P archive](https://discord.com/channels/1445802914156249241/1541197127189921963/threads/1542332777612058624), sessions20260811T152500 and20260825T185242. IDs were checked against the repository's active revision241 cache. Recordings remain local; these notes contain gameplay observations only.

## Ernest the Chicken

The professor advances the journal when he actually explains the missing machine parts. The compost search with a spade plays830 and gives the key after three ticks. Fish food is consumed before the piranhas begin eating at+2 and die at+5. Fountain searching plays881 and opens the player dialogue before granting the pressure gauge or receiving the bite. Logout cancels pending feedback.

The six lever states write varp33 bits1–6 and recompute the nine doors in668. All23 observed configurations, including repeated attempts and the complete oil-can route, now reproduce varbits1794–1802. Lever pulls play2139 and the recorded clunk message. Leaving the basement resets the puzzle.

The three parts are handed over together and varbit19655 changes at the handover. Transformation runs in a private area: the professor approaches the machine, plays832 at+2, the machine hums at+4, graphics173/80 and projectile174 fire at+7, and Ernest3563 replaces the chicken10556 at+9. The canonical public spawn uses6142 so his appearance also follows saved varp32 outside the scene. The client stage becomes3 as Ernest thanks the player; the four Quest points and300coins wait for the final reply. Feather314 and jingle153 match the reward scroll. Interrupted handover/transformation conversations can resume without taking parts again.

**Database capture coverage (2026-11-02):** the rsprox database has no route capture for this quest. Submission 3209 (revision 232) covers Professor Oddenstein's post-quest menu, both replies and their chat-heads (570/567/589), plus the basement lever puzzle. The replies and animations are now in `plugins/quests/data/chathead-animations.json`; the lever/door states are already covered by the 23-state test. The 14 January 2026 journal rewrite has no post-update capture, so its wording remains unverified.

References: [Ernest the Chicken](https://oldschool.runescape.wiki/w/Ernest_the_Chicken), [Draynor Manor](https://oldschool.runescape.wiki/w/Draynor_Manor).

## Dragon Slayer I

Saved internal stages are retained, with the wire milestones mapped to176: first/second repairs remain3, fully repaired6, Ned ready7, Crandor8, Elvarg dead9 and Oziach completion10. Oracle secret1832, four separate offerings3747–3750, ship repairs1835–1837, Ned3751/3752 and Guildmaster instructions3742–3746 persist and restore on login.

Selecting a conversation no longer starts Oziach's challenge, discovers the Oracle secret or recruits Ned. Those effects occur on the recorded lines. Guildmaster start waits for his actual task line, after the advisory warning and confirmation. Klarense takes2000coins when handing over ownership. The magic door accepts each offering independently, preserves partial progress and animates6636 when the fourth arrives. Repairs require a hammer, one plank and30steel nails each; animation3676 precedes each result by two ticks and the result is a native message box.

Boarding the ship does not skip Ned's departure dialogue. The voyage displays the native ship-journey299, route544, clouds543 and flying-dragon545/546 interfaces, then copies the sailing scene into a private instance with Captain Ned824 and Jenkins826. Camera changes follow dialogue, while the two fire volleys use projectile1155, fire objects25155/25156 and the recorded panic/death animations. The crash restores the real beach, clears repair flags and advances176 to8. First descent plays the private20tick Elvarg introduction with817. Crossing the low wall uses the recorded839 exact move and hands control to the canonical Elvarg area.

Elvarg's death creates body25202. The client advances to9 one tick later; head removal plays6654 at+5, then6655 with headless body25203 and proof11279 at+11. Killing the dragon grants no Quest points or quest XP. Returning to Oziach grants2QP and18650Strength/DefenceXP once, with head11279 and jingle152 on the scroll. Completed legacy saves retain their existing completion status.

**Database capture coverage (2026-11-02):** no submission covers the quest route. The archive has the completed journal text (1581), Oziach's clue-scroll dialogue, post-quest Crandor visits and unrelated Melzar sightings, so this quest is skipped until a route capture exists.

References: [Dragon Slayer I](https://oldschool.runescape.wiki/w/Dragon_Slayer_I), [Elvarg](https://oldschool.runescape.wiki/w/Elvarg).

## Shared fixes and checks

Canonical Blurite mining now requires level10 and a usable pickaxe, rolls the Wiki90–350 success curve at the pickaxe's attempt interval, awards17.5MiningXP, depletes the rock and respawns after42game ticks (25seconds rounded up). It no longer grants guaranteed quest-local ore. Smithing exposes an anvil-access check used by Doric for both Smith and item-on-anvil. Quest confirmation warnings pause in native message boxes before their menu. Al Kharid grants free passage at Prince Ali's rescue stage100, before Hassan's reward110.

After building the server, `node --test tests/f2p-adventure-parity.test.cjs tests/npc-dialogues.test.cjs tests/smithing.test.cjs` covers native dialogue round trips, item/state boundaries, all23 recorded Ernest puzzle states, the full sailing/fire/crash sequence, head proof/Oziach rewards, mining probability/respawn and both anvil entry paths. The broader quest regression suite is run before publication.

## Evidence limits

Each recording demonstrates one route. Unrecorded dialogue alternatives and Ernest lever combinations beyond the observed23 are not proven packet-identical. Quest journal text is copied where captured and otherwise keeps semantic descriptions. Temporary HUD mounts are not complete packet-for-packet replicas. The gameplay sequences and state/reward boundaries described above have focused regressions; these presentation limits must not be represented as a verified1:1 replay of every OSRS branch.

Live agent MCP checks on this worktree completed Ernest from the three-part handover through his private transformation, final dialogue and4QP/300coins. A separate staged Dragon Slayer character crossed the wall, fought the actual80HP private Elvarg with whip/shield, collected head11279 while176=9 and QP=0, returned to the real Oziach and completed176=10/QP=2. Both accounts were explicitly logged out. The initial MCP screenshot attempt timed out; a subsequent run of the existing WebGPU harness succeeded and was inspected, showing Ernest human on the rooftop and300coins in the inventory.

Final combined validation: server build,771quest/dialogue/interaction tests,42cannon/tutorial tests, quest-runtime smoke, client typecheck and three camera checks pass. Wormbrain now refuses a map purchase before debiting a full backpack, and interrupted ship repairs retain their supplies.


## Recorded camera coverage

The complete decoded files, including packets outside the dialogue extracts, were audited. Ernest's route (session `20260811T152500`) has no directed camera movement or look commands; its transformation keeps the player's camera. Dragon Slayer I (`20260825T185242`) has 26 directed commands across the voyage, beach and Elvarg introduction. Each now preserves its recorded order, height, two movement rates and `heightrelative=false`; source coordinates are translated into each player's private copy.

| Trigger | Recorded shot, before private-coordinate translation | Rates |
| --- | --- | --- |
| Ned's salt-spray line | Look at `(2069,5517,25)`, move to `(2077,5518,100)`, then move to `(2074,5516,100)` | `232/232`, `232/232`, `1/1` |
| Ned's mighty-fine-ship line | Move to `(2073,5516,100)`, look at `(2066,5517,25)` | `1/1` |
| Player asks how much longer | Move to `(2069,5513,300)`, look at `(2066,5517,100)` | `1/1` |
| Jenkins spots the storm | Look at `(2064,5520,300)`, move to `(2074,5525,1500)`, then move to `(2064,5525,1500)` | `232/232`, `232/232`, `1/1` |
| First fire volley | Move to `(2072,5517,300)`, look at `(2062,5515,100)`, then move to `(2072,5520,300)` | `232/232`, `232/232`, `1/1` |
| Flying-dragon overlay +3 ticks | Move to `(2068,5518,300)`, look at `(2062,5518,100)`, then move to `(2074,5526,300)` | `232/232`, `232/232`, `1/1` |
| Ned's sinking line | Move to `(2074,5526,600)`, look at `(2066,5517,100)`, then move to `(2064,5518,400)` | `232/232`, `232/232`, `1/1` |
| Ned's crash warning | Move to `(2064,5518,400)` without resending the look target | `2/2` |
| Crash +4 ticks | Move to `(2854,3241,300)`, look at `(2849,3238,200)` | `232/232` |
| Elvarg introduction +4 ticks | Look at `(2856,9650,150)`, move to `(2848,9639,475)` | `232/232` |
| Elvarg introduction +7 ticks | Look at `(2866,9640,150)`, move to `(2848,9639,250)` | `2/2` |

Triples in this table are `(tile x, tile y, height)`. Entry clears all five shake channels. The voyage uses the recorded vertical sine shake (amplitude 10, rate 8), clears it for the storm shot, uses amplitude 5 for the second volley and amplitude 10 for sinking, then adds horizontal random shake 20 for the crash. Crash reset is +3, beach camera +4 and final unlock/reset +9. Elvarg returns to the public room at +16, fades in at +17 and unlocks/resets at +20. The scripted camera position and targets translate with that private/public relocation, preserving the in-progress pan without an early reset or a new shot. Dialogue shots follow the actual Continue boundary; recorded time spent reading is not imposed as a delay. The clouds message is the recorded non-clickable five-tick pause, then automatically starts the storm camera and Jenkins line.

The adventure/Falador regressions check camera command order and rates, position-only pans, the timed shots and shake/reset/unlock boundaries. They also check that waiting on an existing reply cannot advance the next camera shot. These packet-level checks do not replace a visual comparison against the recording.
