# Farming plugin

The loader entry is `Farming.plugin.js`; the parts are in `farming/`, one file each:
`Patches` (every hook, patch actions), `Data` (crop and patch tables), `Model` (growth),
`Services`, `Spells`, `Tithe`, `Guild` and `Hespori`, all `*.Farming.js`. They read
`api.core` through `Core.Farming.js`, which the plugin fills before loading them.

Implemented: player-owned patches, saved offline growth, raking, planting,
watering, disease and cures, harvesting, regrowth, compost bins and bottomless
buckets, saplings, gardener payments, leprechaun storage/noting, seed vault,
seed boxes/herb sacks, contracts and rewards, anima plants, farming spells,
amulets, barbarian Farming, Tithe Farm, and a private Hespori encounter/retrieval
service. The generated cache data identifies 110 grouped patches and 40 Tithe
plots; gameplay tables contain 82 crops. XP follows the server's configured rate.

## Comparison with TSPS PR #141

Compared against [PR #141](https://github.com/RSPSApp/tsps/pull/141) at
`718cb8b24202f221a335dd89148e11c245a4fda7`:

- Its 58 crops are already covered. Its 48 patch locations are now covered too:
  the exporter previously missed Port Phasmatys's flower patch and compost bin
  because their regional models use different object IDs.
- Patch changes now send private object removal/re-add packets after the varbit,
  rebuilding the client's geometry for every map tile of the patch. Unchanged
  patches stay quiet; first visits and reused transmit varbits also refresh.
- Transformed click IDs already resolve through `MapObjects.getPrivateArea`,
  shared by object clicks, item use, and spells. No duplicate tile-only router
  was added.
- Cure/prune now follows the local cache's action and respects the supplied
  item. Wrong tools do not consume a carried cure. Lunar Cure Plant still
  bypasses physical tools.
- Watering cans support water pumps and house pumps/gold sinks, reject damaged
  Trouble Brewing pumps, and report empty cans when watering patches/seedlings.
  Herb picking and plant-pot filling use the corresponding farming animations.
- Existing ultracompost, gardener payments, leprechauns, sacks/baskets,
  flower/scarecrow protection, amulets, newer crops, Tithe, and Hespori remain
  available. The reference's simplified seed counts, harvest lives, compost-bin
  mixing, and growth rules were not substituted for our existing mechanics.

## Levels, XP and growth timing

Crop levels, planting/harvest/check-health XP and seed counts are the Wiki's
[Seeds](https://oldschool.runescape.wiki/w/Seeds) tables and each crop page,
held as explicit rows in `Data.Farming.js`. Planting reads the player's current
Farming level (so boosts count) and refuses a lower level with
`You need level <n> Farming to plant that.` before taking a seed or touching
the patch. Planting XP is deferred for every crop until its health check or
until the patch clears after harvest; clearing a dead crop awards that pending
planting XP. Early spade clearing is enabled only when a patch can grow more
than one crop species, matching the June 2026 Wiki update.

Growth is part of the server's one-tick Farming task. `Model.nextGrowth`
aligns every stage to the Wiki's fixed 5/10/20/40/80/160/320/640-minute cycle
and the player's persistent negative offset; `Model.stageAt` exposes the same
table as a pure stage calculation. The one documented exception is a yew's
five-minute first stage, after which it rejoins the 40-minute tree grid. A
diseased crop pauses for the next slower growth cycle (for example, a herb
stops for 40 minutes), not twice its normal cycle.

`Data.FORMULAS` makes every probability explicit:

- Disease per cycle: herbs 27/128, fruit trees 18/128, maple 13/128, magic
  9/128 and coral 8/128, all from
  [Disease (Farming)](https://oldschool.runescape.wiki/w/Disease_(Farming)).
  Compost multipliers are 1, 0.5, 0.2 and 0.1; Iasor is 0.2.
- Yield uses the published 256 denominator, 10% magic-secateurs, 5% Farming
  cape and 5% Attas factors.
- Pruning failure is 25%, amulet-of-bounty seed saving is 25%, redwood
  depletion is 1/11 with a 200-tick regrowth, and the compost and belladonna
  tables are named constants.

## Fidelity limits

This is **not a verified 1:1 implementation**. The patch planting, harvest,
health-check XP timing, early-clearing rules and named herb transforms were
audited against the current Wiki/cache for issue #2360. In particular:

- Disease, compost, watering, yield, Kronos and barbarian rates live in
  `Data.Farming.js`'s `FORMULAS` table, not inside the model. Published rates
  cite the Wiki; entries marked `ponytail:` are explicit estimates. The
  unpublished watering multiplier, non-listed crop disease rate, Kronos skip
  probability and barbarian training failure probability are still estimates.
  Some yield endpoints and Hespori's special/poison scheduling use the same
  `ponytail:` marker.
- Tree chopping uses the existing Woodcutting plugin's axe and success-rate model.
  Player-grown redwoods have four private chopping spots: each depletes with a
  1/11 roll per successful log and regrows independently after 200 game ticks
  (120 seconds), including time offline. Woodcutting Guild redwoods retain
  Forestry's 440-tick depletion timer and 199-tick respawn.
- Seed-vault storage, contracts, and Tithe rewards use existing
  dialogue menus; their original dedicated interfaces are not reproduced.
  Leprechaun storage uses the native main and side screens described below.
  The native Tithe status overlay is mounted during a run (details below).
- Spirit-tree travel currently links player-grown trees. The ordinary network,
  quest-specific crops/access restrictions, achievement completion, and the
  wider quest/diary progression systems are not implemented by this plugin.
- Bologa's unlock checks equipped items using the cache's Zamorak/Saradomin/Guthix
  affiliation flags. Bandos/Armadyl/Zaros gear uses explicit Wiki-listed families
  and their documented cosmetic/locked/charge forms, including Sanguine Torva
  and quartz-upgraded ancient sceptres. New unlisted families require source
  verification; god allegiance is not inferred from deity-name fragments or
  Prayer bonuses. Mixed affiliations (including Staff of Light/Balance) are refused.
- Belladonna hand protection uses the Wiki's published protective families, resolved to
  unnoted hands-slot cache variants (including recolours). Unlisted new families require
  source verification; protection is not inferred from item names or combat stats.
- Region 25287 could not be decoded by the cache export. Its contents are not
  included in the patch coverage claim. No in-game or smoke tests were run.

## Verification

### Native leprechaun storage

Exchange opens `farming_tools` and `farming_tools_side` as main and side modals,
matching normal-world RSProx recordings 224/00238, 227/01533, 230/02879,
232/03121 and 238/04221/04223. In 238/04221, Exchange at tick60 opens both
screens, enables OP1 on the four quantity selectors and runs the modal background
script on the arrival tick. Cache125/126 and scripts1055-1064/2748-2751 supply
the rows, quantity-dependent ops and packed varbits; enum136 maps watering cans
and enum2193 supplies capacities. All component and varbit IDs resolve by name.

The same saved `farm.tools` and `farm.toolMeta` back the interface and NPC/item
deposits. Counts include the extra-bit fields for tools, buckets and compost.
Magic secateurs stay separate from normal ones; watering cans and bottomless
buckets retain cloned charge metadata. Withdrawals use the inventory's actual
addable amount, including note-stack limits. The shared Bank PIN guard remains
in front of storage and is checked again for native actions. Closed screens,
walk-away, trade/death, logout and stale amount answers cannot transfer items.

The [Tool Leprechaun](https://oldschool.runescape.wiki/w/Tool_Leprechaun) Wiki
supplies storage capacities and noted deposits/withdrawals. No ordinary-world
recording shows every quantity/Banknotes path: their op order follows the cache;
Banknotes uses the selected quantity, and X remembers a positive amount for the
open session. The amount prompt wording is ours. Produce noting is unchanged.

### Other Farming verification

Geomancy refuses casting while attacking or being attacked, before rune
consumption, Magic XP, animation or patch updates. It retains the existing
shared combat definition and ordinary casting checks once combat ends.
RSProx recording 1221 (revision 238, click `magic_spellbook:geomancy` at
tick 5769) supplies the exact refusal text. That recording is a Leagues world;
no League rune-restoration, timing or reward rules are imported. The
[Geomancy article](https://oldschool.runescape.wiki/w/Geomancy) documents
the ordinary 65 Magic, 60 XP and 3 astral/3 nature/8 earth rune cost.
Geomancy uses the native Farming browser described below.

Ordinary tree stumps yield one to four roots at eight-level intervals above
the crop's planting level: oak 15/23/31/39, willow 30/38/46/54, maple
45/53/61/69, yew 60/68/76/84 and magic 75/83/91/99. The current Farming
level when digging includes temporary boosts and drains. Inventory capacity
is checked for the complete reward before clearing the stump.
Source: [Tree roots (Farming)](https://oldschool.runescape.wiki/w/Tree_roots_(Farming)).
Regression checks drive the object interaction with real inventories and
cache definitions, including every threshold, boost/drain, repeat clicks,
missing spades, full inventory and dead/fruit-tree exclusions.

### Native Tithe status overlay

The revision241 cache resolves `hosidius_strip_farming` to group241 and
`toplevel_osrs_stretch:overlay_hud` to161:8. Entry/relogin mounts this existing
overlay; its onLoad1193 and renderer1195 read `hosidius_tithe_type`4901,
`hosidius_tithe_score`4900 and `hosidius_tithe_rewardpoints`4893. Existing
inventory/varp transmit scripts refresh the fruit icon, batch count and points.
Planting the final seed does not clear the selected crop. Leaving/logging out
closes the interface only if the Tithe group is still mounted, preserving any
replacement HUD. `zeah_tithe_minigame_unlocked`4909 stays unlocked on exit.

Sources: local cache widget241 and scripts1193/1195, plus the
[Tithe Farm](https://oldschool.runescape.wiki/w/Tithe_Farm) batch/point rules.
The local RSProx index has no recording naming this overlay; exact packet timing
is not claimed. Regression checks use real Player inventories and PacketSender
mount tracking for all three crops, relog, last-seed planting, deposit and cleanup.
The reward shop remains a separate interface gap.

Coral yields use the post-19-August-2026 six harvest lives and the published
low/high calculator endpoints: Elkhorn 85/182, Pillar 25/180 and Umbral -50/178.
Sources: [Elkhorn frag](https://oldschool.runescape.wiki/w/Elkhorn_frag),
[Pillar frag](https://oldschool.runescape.wiki/w/Pillar_frag),
[Umbral frag](https://oldschool.runescape.wiki/w/Umbral_frag).
Existing mature saved patches retain their remaining lives; this does not refill
partly harvested patches. The coral regression file covers species-specific
chances, modifiers, final collection, offline/online equivalence and JSON state.

From `server/`:

```powershell
npx.cmd tsc --noEmit
node --test tests/farming-model.test.cjs tests/farming-capture-lines.test.cjs
node --test tests/farming-redwood.test.cjs tests/woodcutting-guild.test.cjs
node --test tests/bologa-blessing.test.cjs tests/belladonna-harvest.test.cjs
node --test tests/farming-coral-yields.test.cjs
node --test tests/farming-herb-sack-withdraw-order.test.cjs tests/herblore.test.cjs
node --test tests/farming-falador-diary-xp.test.cjs
node --test tests/farming-hespori-recoil.test.cjs tests/ring-of-recoil.test.cjs tests/ring-of-suffering.test.cjs
```

Herb-sack Empty uses the canonical Herblore cleaning levels through `herblore:clean`,
so limited inventory space is filled from the lowest-level herb first (including
Huasca before Snapdragon). Regression checks cover both sack variants, partial/repeated
withdrawals and full inventories. Source: [Herb sack](https://oldschool.runescape.wiki/w/Herb_sack).

An open sack also takes grimy herbs picked up from the ground and herbs harvested from a herbiboar,
as it does from patches, whole or not at all for a pickup and per herb for a harvest, while it has room
(30 of each type here, 100 in a silklined sack). A closed sack takes none. Wiki: "will automatically
store any grimy herbs that are picked up", "provided there is space for it". No message is shown, as none is documented.

A pristine spider silk (Sarachnis's) used on a herb sack makes it a silklined herb sack, which stores 100 of each grimy herb
and otherwise works the same, open or closed. The upgrade has no cost or level requirement (Wiki: [Silklined herb sack](https://oldschool.runescape.wiki/w/Silklined_herb_sack)).
Assumed, as no source says: the herbs already in the sack are kept, an open sack stays open, and no message is shown.

The four South Falador allotment/flower/herb patches award 10% extra Farming XP
after the Medium Falador Diary, queried through canonical diary progress. The
bonus follows the acted-on patch; it does not apply to Falador Park trees,
other planes/patches or unrelated Farming awards. Tests cover composting,
planting, harvesting, deferred herb planting XP and incomplete/easy-only diaries.
Source: [South Falador Farm](https://oldschool.runescape.wiki/w/South_Falador_Farm).

The grown Farming Hespori is immune to ordinary-ring and Ring of Suffering recoil.
Its content sets the generic `combat:recoil-immune` policy used by both recoil paths;
Vengeance/Retribution retain their existing reflected-damage behavior. Tests verify
the actual boss wake-up, unchanged flowers, charge conservation and normal recoil.
Source: [Hespori](https://oldschool.runescape.wiki/w/Hespori).

The second command checks the state machine and mocked hooks without server startup
or sockets. It covers every documented crop cycle at its exact stage times (including
yew's five-minute first stage and the 640-minute diseased pause), the planting level
gate and boosted levels, offline/save equivalence, disease/death, mature immunity,
private stump regrowth, herb formulas, critical cache states, Tithe growth/scoring,
null bank tabs, growth cadence, seedling deadlines and nearby patch selection across
region boundaries. Cache-only audits also checked crop item resolution and growing,
diseased, dead, and mature visual values.

Redwood regressions cover independent spots/players, exact tick deadlines between
minute sweeps, saved offline deadlines, old whole-tree stump saves, all sixteen
private branch combinations, upper-floor geometry and a complete Woodcutting
request/log/depletion cycle. Cache revision 241 region 4922 contains four Cut
multilocs named `farming_redwood_tree_patch_1_{2,4,6,8}`, controlled by varbit
7907: healthy value 18 and depleted-spot masks 41–55. Ground and first-floor locs
are refreshed privately when that value changes. The timer uses the ordinary
600 ms server tick; raw packet-capture verification remains outstanding.

An old redwood whole-tree stump save has no branch identity. Its remaining
deadline is preserved for all four spots once, after which they regrow independently.
New planting/clearing starts without old branch deadlines.

To regenerate `plugins/skills/data/farming-data.json` (one crop, patch type, patch or loc per line):

```powershell
node -r ts-node/register/transpile-only scripts/generate-farming-data.ts ../..\runelite
```

Sources: [Farming](https://oldschool.runescape.wiki/w/Farming),
[Disease](https://oldschool.runescape.wiki/w/Disease_(Farming)),
[herb calculator](https://oldschool.runescape.wiki/w/Calculator:Farming/Herbs),
[Tithe Farm](https://oldschool.runescape.wiki/w/Tithe_Farm),
[Hespori](https://oldschool.runescape.wiki/w/Hespori), and the linked crop/tool
pages (OSRS Index's attributed wiki copies were used where direct access failed).
RuneLite supplies timing/varbit interpretation; the local cache supplies object
transforms and map locations. The BSD-2-Clause attribution for the RuneLite-derived
data is kept in the JSON's `source` field.

## Bologa unlock verification

The unlock retains 50 Prayer and a one-time 75,000-coin payment. Equipment,
distance, funds and current Farming state are validated at confirmation;
successful payment requests persistence. Currency is cache item `COINS` (995),
not the non-stackable quest item Coins (617) selected by a name-only lookup.
Equipment affiliation parameters are 40 (Saradomin), 41 (Zamorak), 42 (Guthix).
Only real positive-quantity equipment in its correct cache wear slot counts.

Sources: [Bologa](https://oldschool.runescape.wiki/w/Bologa),
[dialogue transcript](https://oldschool.runescape.wiki/w/Transcript:Bologa),
[god-equipment table](https://oldschool.runescape.wiki/w/God_Wars_Dungeon#God-related_protection),
[Torva variants](https://oldschool.runescape.wiki/w/Torva_armour#Sanguine_torva),
[ancient sceptre upgrades](https://oldschool.runescape.wiki/w/Ancient_sceptre#Quartz_upgrades).
The general blessing-item article additionally mentions 65 Cooking, while the
NPC article and actual dialogue list no Cooking unlock gate; this equipment
change preserves the dialogue's Prayer-only level gate and does not change
grape use/yield rules or introduce a new Cooking requirement.

Tests use real Player, inventory, equipment and cache definitions, driving the
actual Tithe NPC/payment and reward callbacks. Menu rendering and persistence
requests are mocked; live dialogue rendering and packet-capture verification
are not claimed.

## Storage Bank PIN protection

The Seed Vault and Tool Leprechaun storage use the shared `bank-pin:guard`
event before opening menus or moving stored items. Leprechaun Deposit-all and
item-on-NPC tool deposits follow the same guard. Correct entry resumes the
original action, rechecking proximity and the selected tool slot. Produce
noting does not access stored tools and retains its existing behavior.

Sources: [Bank PIN, situations requiring a PIN](https://oldschool.runescape.wiki/w/Bank_PIN#Situations_requiring_a_PIN)
and [Hosidius Rework and Deadman Beta](https://oldschool.runescape.wiki/w/Update:Hosidius_Rework_and_Deadman_Beta).
The regression checks drive the actual shared keypad and storage handlers;
menu rendering and scheduled ticks use the existing Bank PIN test fixture.

## Native Farming menu choices

The Farming chooser translates one-based native option resumes into its displayed
action list. Its interface-action adapter also handles the legacy widget input
before the shared fallback changes the index. The adapter owns only the exact
options widget and a Farming-created current dialogue; other plugins' menus and
the shared DialogueManager are unchanged.
The action stays private to that adapter, so an unrelated widget cannot reach it
through the shared legacy dialogue fallback.

Choices validate bounds, current dialogue/chatbox ownership and player state
before closing the interface. Repeated or stale choices cannot reuse a closed
menu, and a busy/dead/newly placed player cannot accept a pending action. Single
action menus include Cancel for the cache's two-row minimum; empty menus are not
opened. Four entries per page and More options keep their existing order.

`farming-dialogue-input.test.cjs` uses all plugins and real Player, Inventory,
MovementQueue, PacketSender, DialogueManager and NPC.create objects. It sends
native resume/widget packets, advances each player's actual walk-to task and
checks Tithe seed/quantity choices and gardener payment, including capacity,
range, duplicate input and stale/busy-state cases. The
[Tithe Farm Wiki page](https://oldschool.runescape.wiki/w/Tithe_Farm) supplies the
seed types/levels; the existing seed quantities and payment tables are unchanged.
No applicable normal-world capture was found for these menus; option indexing
comes from the cache's options interface and the server's native resume contract.

## Native Geomancy input

Geomancy's cache spellbook widget (`magic_spellbook:geomancy`, 218:150 in this
cache) reaches the Farming handler through `onInterfaceActionClick`, as well as
the existing legacy button hook. Only the Cast action is accepted; a busy or
dead player cannot pay for a cast. The existing combat refusal, spellbook/level
checks, rune consumption and XP award remain in the same handler.

RSProx `238/01221` and `238/04128` identify the widget; the former records
"You can't commune with the land while fighting." Both recordings are special
worlds, so no League resource/timing rules are imported. The
[Geomancy Wiki page](https://oldschool.runescape.wiki/w/Geomancy) supplies the
ordinary 65 Magic requirement, 3 astral/3 nature/8 earth cost and 60 XP.
`farming-geomancy-input.test.cjs` drives widget packets through the real network
dispatcher, with all plugins and real Player/Inventory/PacketSender objects.
The native Geomancy browser is documented in [farming-geomancy.md](../../docs/farming-geomancy.md).

## Compost bin filling (issue #1391)

Using unnoted compostable produce on either bin starts automatic deposits of that
same item until it runs out or the bin reaches 15 items (30 in the Farming Guild).
The existing Farming work queue cancels pending deposits on movement, new world
input, logout, death or a busy interface; every deposit rechecks the inventory and
original bin state. Bin phases count Farming task ticks rather than milliseconds,
so scheduler jitter cannot stretch the two-tick cadence. Each deposit updates the owner's patch varbit and appearance.

The [Wiki's compost-bin change history](https://oldschool.runescape.wiki/w/Compost_bin#Changes)
confirms automatic filling. In rsprox captures, recording **1858** (revision 227,
Leagues V), one use of pineapple on `farming_compost_bin_3` produces
`human_pickuptable` and sound 2441 at tick +2, then consumes one pineapple at +3.
The animation/sound and deposit repeat every two ticks (12 deposits through +25,
the trace window limit). The rev 241 cache maps `human_pickuptable` to sequence
832. This capture covers a regular bin on Leagues; no main-game or Farming Guild
bin capture was found. The shared loop uses the same cadence for both bin sizes.

`tests/farming-compost-inputs.test.cjs` covers automatic filling, cadence, capacity,
selected-item exhaustion, interruption and stale bin/inventory state, alongside
existing ingredient, tier and noted-item checks.

The only production callers of `Services.binAction` are the object and item-on-object
handlers in `Patches.Farming.js`; only item use supplies an ingredient and starts
filling. `UseItemPacketListener.itemOnObject` first validates the selected item and
map object, then calls `MovementQueue.walkToObject`. Its arrival callback checks
`MapObjects.stillStands` before dispatching the Farming item-use hook. Thus bin work
starts after the normal object-reach check; it does not expose a remote command or
endpoint. The work entry retains the arrival position and cancels if the player
moves. Filling awards no XP and needs no separate level-up pause mechanism.

The compost regression fixture advances Farming ticks without advancing the wall
clock. An additional regression varies elapsed milliseconds across early, delayed
and catch-up ticks and verifies the animation/deposit phases remain at +2/+3 and
every two ticks thereafter.

## Cure Plant parity

The [Cure Plant Wiki article](https://oldschool.runescape.wiki/w/Cure_Plant)
specifies 91.5 Farming XP, 60 Magic XP, level 66 Magic and one astral/eight earth
runes. A successful cast now awards the Farming XP through the existing Farming
reward helper after restoring the diseased crop. It retains the crop's stage,
resumes its growth clock, and needs neither secateurs nor a plant-cure potion.
A repeat cast on the healthy crop cannot award XP or consume another cast.

The same article supplies separate refusals for healthy growing crops, fully
grown crops, compost bins, weeds, empty patches and dead crops. These branches
return before consuming runes or awarding XP. Unrelated scenery now reaches the
Wiki's player-spoken refusal instead of being ignored by the patch router.
Other farming spells still leave unrelated scenery unhandled.

`tests/farming-cure-plant.test.cjs` covers both skill awards, herb/tree cures,
repeat casts, insufficient Magic/runes, all six patch refusals and the registered
object-spell hook's unrelated-scenery branch. Nine of its ten checks fail against
the previous implementation; all ten pass with the fix. The complete Farming
regression suite passes 315 checks, including Fertile Soil and Resurrect Crops.

An in-game server check planted a ranarr normally, advanced its growth until it
became diseased, then cast on the actual patch. It consumed one astral/eight
earth runes, changed the crop back to healthy growing, and increased the whole-XP
snapshots by 60 Magic and 91 Farming (the skill system retains fractional XP).
Weed and empty-patch refusals were also observed through normal object casting.
Further checks verified the healthy-crop, compost-bin and player-spoken scenery
refusals without changing runes or XP, then confirmed inventory and XP after relogging.

Evidence for this change is the Wiki, fetched on 27 October 2026. Recordings 75
and 86 are Leagues widget clicks followed by Moonclan teleports, not evidence of
curing a crop; recordings 3254 and 3262 show a Pyromancer using a similarly named
sequence. They are not used to infer Cure Plant's animation, graphics, timing,
sounds or interface packet order. Those details remain unverified against live
OSRS; no claim of complete visual or timing parity is made.
