# Wyrmscraig golem crafting

The members activity is registered by `GolemCrafting.plugin.js`. After Fallen From
Grace and at 60 base and current Crafting, a player can start either cache plinth
with four sunstones, a chisel (including Jeweller's chisel) and a hammer. Each of
the four cardinal sides needs five shaping steps. With one click, these are four
game ticks apart: 20 ticks per side. Continuous repeated shaping input takes 15
ticks per side, 60 for four sides excluding movement. Movement,
other world input, leaving the area and logout stop the active shaping action.
Repeated clicks on the same side can shorten only its pending step to three
ticks. They add no progress themselves and cannot queue faster steps or reset
the deadline. After each step, the next one defaults to four ticks again.

The Wiki states the continuous-spam total and describes clicking on the XP-drop
tick to speed up the next action. It does not establish the first-action phase
or exact input/XP packet order. TSPS uses an explicit input convention: an extra
matching click before the current step's third tick may shorten that step,
including the first. A click after that tick was processed cannot backdate it.
This convention supports the published spam total; it is not a measured retail
input-window rule. Sparse exact-XP-drop timing and retail per-stroke XP are not
validated. The existing deferred aggregate XP is unchanged.

The paid base and completed shaping steps are saved per player. The two plinths
and all four sides have separate native progress/rubble variables. Players can
share the public tiles without sharing construction progress. No new map objects
or interface framework replaces the cache's station multilocs.

From the golem's front, Insert-core consumes one sunstone core and one of the
fourteen Wiki-listed furs, taking carried inventory fur before a carried fur
pouch. Tatty furs cannot be used. Completion grants 1,560 plus the selected fur's
Crafting XP, subject to the world's normal multiplier, and no Hunter XP. A gem
enters an open gem bag when it has room; otherwise the gift is placed on the
ground. The gift is a Jeweller's chisel with probability 1/300, otherwise a gem
with sapphire/emerald/ruby/diamond weights 15/5/2/1. These are activity rewards;
this change does not alter NPC drop tables.

The completed personal golem blocks reuse of that player's station for 30 ticks.
Leaving the area or logging out removes that visual NPC and its transient
cooldown. Paid unfinished station progress is retained. Existing Mining supplies
Sunstone rocks; the globally registered Fallen From Grace item handler supplies
instant core creation at 60 current Crafting for 10 Crafting XP. The shared fur
storage API permits fur consumption; meat pouches retain their existing rules.

## Evidence and limits

Rules were read on 13 November 2026 from the OSRS Wiki pages
[Golem crafting](https://oldschool.runescape.wiki/w/Golem_crafting),
[Golem (sunstone)](https://oldschool.runescape.wiki/w/Golem_(sunstone)),
[its transcript](https://oldschool.runescape.wiki/w/Transcript:Golem_(sunstone)),
[Sunstone core](https://oldschool.runescape.wiki/w/Sunstone_core), and
[Jeweller's chisel](https://oldschool.runescape.wiki/w/Jeweller%27s_chisel).
The tracker incorrectly calls for Hunter XP when a fur is used: its Hunter level
is an acquisition requirement; its fur XP contributes to Crafting.

The matching revision 242 research reference is
[Joshua-F/osrs-dumps at 853150e3f75e1463391b470f98caf5d3bf796339](https://github.com/Joshua-F/osrs-dumps/tree/853150e3f75e1463391b470f98caf5d3bf796339).
`config/dump.loc` supplies station roots, transforms and side rubble;
`config/dump.varbit` supplies private stage/progress/count fields; `config/dump.seq`
supplies the shaping and golem animation names. Native test initialization checks
the active cache definitions and real mapped station roots before interactions.

The full base XP is deliberately deferred to completion: the published total is
known, but its retail distribution between strokes is unverified. The regular
four-tick and continuous-spam aggregate rhythms are implemented with the input
convention above. The assumed model-front rotation has not been independently checked
against a retail scene; the wrong-side test establishes enforcement relative to
that assumption. NPC movement paths, exact sound/packet ordering and an original
activity overlay are not claimed. No applicable activity capture was established.
Historical token-search hits inspected by the stack were unrelated quest/music
events, and search misses are not evidence of retail absence.

`server/tests/golem-crafting.test.cjs` exercises the registered object-action
listener with real compiled engine, cache, world-admitted players, area processing,
inventory, skills and storage. Setup supplies completed quest state, items and
side positions. It does not prove natural quest traversal, rendered client
appearance, packet decoding or a browser playthrough. Runtime results and their
source identities must accompany a delivery claim; adding this fixture alone is
not runtime verification.
