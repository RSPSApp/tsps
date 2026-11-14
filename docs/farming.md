# Farming patches

How farming patches answer clicks: the animation, sound and line of each action and the tick it
happens on. The plugin is `server/plugins/skills/farming/` (`Patches.Farming.js` for patches,
`Services.Farming.js` for compost bins and gardeners, `Hespori.Farming.js` for the Hespori patch).

Sources: rsprox captures (https://rsprox.net/database) of live OSRS, revisions 224-238. Most farming
recordings are Leagues V worlds (127, 545-552, 571, 819, 1723, 1834-1885, 3282); main-game ones are
86, 238, 239, 312, 1098-1149, 1533, 1837, 3121 and 3276. Leagues recordings are used for lines,
animations, sounds and timing, never for XP. Ids are the rev 241 cache's.

Ticks count from the player's arrival at the patch.

## Patch actions

| Action | Tick 0 | Later | Lines |
| --- | --- | --- | --- |
| Rake | | swing `farming_raking` (2273) + sound 2442 at +2, then every 4 ticks; each swing after the first pulls a weed | none; no rake: "You need a rake to weed a farming patch." |
| Plant a seed | `farming_seed_dibbing` (2291), bare-handed `farming_seed_dibbing_nodib` (10721), sound 2432, seeds removed | +3: patch, XP, line | spam "You plant a tarromin seed in the herb patch.", "You plant 3 potato seeds in the allotment.", "You plant a Bittercap mushroom spore in the bittercap mushroom patch." |
| Plant a sapling | `human_dig` (830), sound 1470 | +1: sapling for an empty pot, patch, XP, line | spam "You plant the yew sapling in the tree patch.", "the magic tree sapling", "the palm tree sapling in the fruit tree patch.", hardwood: "You plant the plantpot in the hardwood tree patch.", "You plant the Spirit Tree sapling." |
| Compost | `farming_pour_water` (2283), sound 2427 | +2: bucket emptied, patch, XP, line | game "You treat the tree patch with ultracompost." (the patch's name, the compost's name) |
| Fill a plant pot | `farming_trowel_shortdig` (11121) | +2: filled pot | "You can only fill a plantpot from an empty farming patch.", "This patch needs weeding first." |
| Inspect | | | game "This is a fruit tree patch. The soil has been treated with ultracompost. The patch has Palm tree growing in it and is at state 3/6." Empty: "The patch is empty and weeded." / "The patch needs weeding." Grown: "The patch (Crystal tree) is fully grown." Protected: a second line, "A nearby gardener is looking after this patch for you." |
| Check health | | | spam "You examine the tree for signs of disease and find that it is in perfect health." ("the Spirit Tree", "the Calquat Tree", "the potato cactus"), then the Hespori seed roll |
| Dig up | confirm "Are you sure you want to dig up this patch?" / "Yes, I want to clear it for new crops." / "No, I want to leave it as it is." | `human_dig` + 1470 at 0 and +3, cleared at +5 | spam "You start digging the farming patch..." then "You have successfully cleared this patch for new crops."; stumps: "You start digging up the (fruit) tree stump." / "You dig up the (fruit) tree stump."; no spade: "You need a spade to clear a farming patch." |
| Chop without an axe | | | tree patches: "You need an axe to chop down this tree.<br>You do not have an axe which you have the woodcutting level to use."; fruit and crystal trees: "...that you have the Woodcutting level to use." |

## Harvests

Each swing repeats every 3 ticks; the produce comes `delay` ticks after its swing.

| Patch | Swing | Delay | Lines |
| --- | --- | --- | --- |
| Allotment, hops | `human_dig` + 1470 | 1 | spam "You begin to harvest the allotment." on the click; game "The allotment is now empty." |
| Herb | `picking_low` (2282) | 1 | "You begin to harvest the herb patch." / "The herb patch is now empty." |
| Fruit tree | `picking_high` (2280) | 2, sound 2437 with the fruit | spam "You pick a coconut." each pick |
| Mushroom | `farming_pick_mushroom` (2292) + 2437 | 2 | spam "You pick a Bittercap mushroom." |
| Belladonna | `picking_low` + 2437 | 3 | spam "You pick some Deadly Nightshade." |
| Flower | `farming_pick_mushroom` + 2437 | 3 | none |
| Crystal tree | the axe's swing, spam "You swing your axe at the tree." | 4, sound 2541 | spam "You shatter the crystal tree into crystal shards." |

When the inventory fills: spam "You have run out of inventory space.", on the tick the last slot fills.

## Compost bins (recording 1858)

- **Fill:** `human_pickuptable` (832) + 2441 two ticks after the click, the item a tick later, every two ticks.
- **Close:** `human_push` (810) + 2428 and spam "You close the compost bin.", then a tick later game "The contents have begun to rot." and the bin closes.
- **Open:** `human_push` + 2429 and spam "You open the compost bin.", the bin opening a tick later.
- **Take compost:** `human_pickuptable` + 2436, the bucket filled a tick later, every four ticks.

## Gardeners

- **A grown tree:** "Pay 200 Coins to have your tree chopped down?" (Yes./No.).
- **Protection:** "Pay 25 coconuts?" (Yes./No./Yes and don't ask again.), then spam "You pay the gardener 25 coconuts to protect the patch." and the gardener's "That'll do nicely, sir. Leave it with me - I'll make sure that patch grows for you." Without the payment the gardener says "I want 25 coconuts for that."
- **Other answers:** "That patch is already fully grown! I don't know what you want me to do with it!" and, with no sapling in a tree patch, "You don't have a sapling planted in that patch. Plant one and I might agree to look after it for you."

## Hespori (recording 3282)

- **Harvest a grown Hespori:** a tick later game "The Hespori doesn't take kindly to your attempt to harvest it.", sound 4059, the player is moved to (1246, 10085) in front of the patch, and the fight starts.
- **Entangle:** game `<col=ef1020>The Hespori entangles you in some vines!</col>` with spotanim `hespori_vine_impact` (tick 557).
- **Kill:** about 4 ticks after `hespori_death`, game "Your Hespori kill count is: <col=ff0000>N</col>." (varp `total_hespori_kills`, counted through Combat Achievements), then "Fight duration: <col=ff0000>m:ss</col> (new personal best)" or "Fight duration: <col=ff0000>m:ss</col>. Personal best: m:ss"; a tie is not a new best (tick 481). Nothing else is said. Ten kills, harvest line to kill-count line: 50 ticks "0:29", 47 "0:28" (twice), 63 "0:37" (twice), 54 "0:32", 65 "0:38", 51 "0:30", 56 "0:33", 60 "0:35", so ours prints `floor((ticks * 600 - 1) / 1000)` seconds.
- **Clear after the fight:** spam "You start digging the farming patch...", `human_dig` + 1470 at 0 and +3, then at +5 the loot and spam "You have successfully cleared this patch for new crops.". No spade: "You need a spade to clear a farming patch."; fewer than two free slots: message box "You need at least two free spaces in your inventory to clear this patch."

## Seed box (rsprox captures 960, 966, 982, 1022, 1029, 3883, 3906, 4222, 4293, 4295)

- Fill answers one `Stored N x <Seed> in your seed box.` line per kind stored; with no seed to store it says
  `You have no seeds that will fit in the seed box.` (960). `You don't have space in your seed box for that.` is also
  recorded on Fill (966, 974); the captures do not show its trigger, so ours sends it when the box takes none of the
  seeds carried because its six kind slots are full (and for a seed used on such a box).
- Empty answers `Emptied N x <Seed> to your inventory.` per kind; the native bank Empty op answers
  `Your seed box is now empty.` or `Your seed box is already empty.` (1029).
- Check opens `hosidius_seedbox` (modal over `seed_box`, six slots, the `busy` varbit set while open). Ops 1-5 are
  `Withdraw 1`, `Withdraw 3`, `Withdraw 4`, `Withdraw X`, `Withdraw All` (each prints the Emptied line), op 10 examines
  the seed. Close lists `The seed box contains:` then `N x <Seed>.` per kind (3906, 1022).
- Slot order: the box is six fixed slots. Kinds keep the order they were stored in (4222: Fill stored Belladonna,
  Potato cactus, Poison ivy, Cactus, Magic, Watermelon and the window and Close list them so); a kind withdrawn in full
  leaves its slot empty (`slot=4, id=-1`, 4293), and the next new kind fills that slot (4293: Snapdragon in slot 4).
  Empty follows the same order (3883: Toadflax, Avantoe, Cadantine, Kwuarm, Snapdragon, Irit). From rev 238 the slots
  carry DEPTH1 and DRAGTARGET and `interface_inv_init`'s fifth argument is 1; a drag of slot 1 onto slot 0 swaps the
  two (4222, one `if_buttond` and the `update_inv_partial` naming both). A drop on an empty slot moves the kind there
  (ours: not recorded). Boxes saved before the order was kept list their kinds by item id.
- Used on a patch, the box plants the first stored seed, in slot order, that suits the patch (Wiki: Seed box, 3 June
  2026; no recording shows a planting). With none, a mesbox: `Your seed box does not contain any seeds that can be
  planted in this patch.` (4222, herb patch). On a tree patch, which takes saplings, `Nothing interesting happens.`
  (4222). Ours: the first seed of the patch's type is the one tried, and the planting then answers as that seed used
  from the inventory would (weeds, level, tool, seed count).
- The Wiki's Seed_box page (fetched this session) says Check lists the contents in chat; the captures show the window
  instead, so the captures are followed.
