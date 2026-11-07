# Giants' Foundry

Kovac's sword-smithing minigame in the cave under the Giants' Plateau. Sleeping Giants unlocks it. Behaviour follows the OSRS Wiki for XP, reputation and rates; ids, messages, animations, sounds, varbits and tick timing come from live rsprox captures and the rev 241 cache. It is one plugin, `server/plugins/minigames/GiantsFoundry.plugin.js`, which delegates to one unit per station in `server/plugins/minigames/giantsfoundry/`.

All four recordings with foundry play were made on Leagues V worlds (rev 227): 96, 100, 101 and 565. Recording 96 also holds a full Sleeping Giants playthrough. Their rules may differ from the main game, so the numbers the Wiki gives (XP, reputation, rates) win over them.

## Layout

| File | What it owns |
| --- | --- |
| `Shared.GiantsFoundry.js` | Ids, varbits, the player's varbit-backed state, helpers, and the per-tick hooks the stations use. |
| `State.GiantsFoundry.js` | Persistence and the login sync of every foundry varbit. |
| `Area.GiantsFoundry.js` | The cave as an Area: the room's machinery, per-tick work, storing the preform on leaving. |
| `Preform.GiantsFoundry.js` | Wearing the preform, the HUD, the preform storage. |
| `Kovac.GiantsFoundry.js` | Commissions; Talk-to's commission conditions and `[sword style]` blanks. |
| `Mould.GiantsFoundry.js` | The mould jig and its setup interface (718); the mould score. |
| `Crucible.GiantsFoundry.js` | Filling (Fill menu, item-on), Check, Empty, Pour; the metal score. |
| `Tools.GiantsFoundry.js` | Trip hammer, grindstone and polishing wheel: machine ticks, damage, sweet spots, overworking, the Smiths' uniform. |
| `Temperature.GiantsFoundry.js` | Lava pool, waterfall and passive cooling. |
| `RewardShop.GiantsFoundry.js` | Kovac's reward shop (753) from cache enum 4379: buying items and moulds. |
| `Rewards.GiantsFoundry.js` | The ore pack, Kovac's grog, and selling items back to Kovac. |
| `Commands.GiantsFoundry.js` | `::foundryrep <amount>` (developer): sets Foundry Reputation. |
| `data/giants-foundry.json` | Crucible metals (tier, smelting level) and what smithed equipment is worth. |

**Changes outside the plugin:**
- **Kovac** is `kovac_multi` (11560) in `npc-spawns.json`, at the captured tile (3369, 11486) facing north-west. The cache resolves it from varbit 13902: 11470 (Talk-to only) until the quest reads 30, then 11472 with Hand-in, Commission and Shop.
- **`npc-dialogues.json`**: "Transcript:Kovac"'s plain "I'm not sure what something does." option is now conditioned on having no commission (id `Gf7nCm`). The live menu with a commission shows only the ", can you help me?" form (recording 565).
- **Sleeping Giants** makes its tutorial sword on this plugin's crucible, jig, tools and HUD.
  - It hands out the Flat Broad commission through `giants-foundry:start-commission` (`{ player, words, tutorial }`); a tutorial preform's stages are trip hammer, grindstone, polishing wheel.
  - It lets the player use the foundry from that point (`giants-foundry:access`), and follows the sword through `giants-foundry:step`: `metal-added`, `crucible-full`, `mould-set`, `poured`, `preform-taken`, `hammered`, `ground`, `polished`, `finished`.
  - It takes the finished sword with `giants-foundry:discard-preform`.
  - It no longer places its own tutorial crucible, jig, storage, chest and crate. Those blocked live paths, such as the corridor to the waterfall. It uses the room's own supply crate (multiloc 44779 on tutorial varbit 13903), with the captured contents: 8 bronze bars, 6 iron bars, 2 bronze battleaxes, 2 iron longswords, and a bronze and an iron platebody, which make 28 bars' worth.
  - It no longer spawns its own foundry Kovac (11468).
  - Its stages map to live OSRS's varbit values (13902: 15 repairing, 20 repaired, 25 making the sword, 30 complete), as does the tutorial varbit (13903, 10-65).
- **The generic stand-in shop is gone.** Shop 1443 in `shops.json` and its "Foundry Reputation" point currency in `Shopkeepers` (with its `reward-shops.json` entry) are removed; interface 753 replaces them. Reputation saved under `shop-currency:Foundry Reputation` moves to the foundry's own at login.
- **`QuestRuntime`**: a quest's `varpValue` now also maps the stage it sends in a varbit, so a quest can keep its own stage numbers and show live values.

## Cache

The client draws everything from varbits; the server keeps them right.

**Varps**
- 3429-3433: the varbits below.
- 3435: shop selection.
- 3436: Foundry Reputation.

**Varbits**

| Varbit | Name | Values |
| --- | --- | --- |
| 13902 | `sleeping_giants` | quest stage, 30 = complete |
| 13903 | `sleeping_giants_tutorial` | 0-65 in fives |
| 13907, 13908 | commission words | enum 4372: 1 Narrow, 2 Light, 3 Flat, 4 Broad, 5 Heavy, 6 Spiked |
| 13909 | mould tab | 0 forte, 1 blade, 2 tip |
| 13910-13912 | selected forte / blade / tip | index into enums 4373 / 4374 / 4375 |
| 13913 | alloy difficulty | the poured metal's score |
| 13914 | jig state (multiloc 44777) | 0 empty, 1 set, 2 poured, 3 cooled |
| 13916-13930 | bought moulds | one per mould |
| 13931-13936 | metal counts | bronze to rune |
| 13937 | crucible state (multiloc 44776) | 0 empty, 1 partial, 2 full |
| 13938, 13939, 13950 | preform difficulty, quality, start quality | |
| 13940-13945 | stage seeds 1-6 | 0 hammer, 1 grind, 2 polish |
| 13947 | preform stored (multiloc 44778) | |
| 13948, 13949 | temperature, completion | 0-1000 |
| 13957 | collection log completed | |

**Interfaces and scripts**
- HUD 754, mould setup 718, reward shop 753.
- 6119: difficulty → stage count.
  - below 20: 3 stages
  - 20-59: 4
  - 60-89: 5
  - 90-119: 6
  - 120 and up: 7
- 6121: each tool's heat zone. It is centred on 832 (hammer), 499 (grind) and 166 (polish), with width `333 - difficulty * 167 / 130`.
- 6122 `giants_foundry_hud_set_sweetspot`: 1 gold, 2 green, 0 clears.

**Enums and structs**
- Mould parts: enums 4373-4375 point to structs.
  - Param 1621 is the name and 1622 the level.
  - Params 1625 / 1626 / 1627 are signed stats on the Broad−Narrow, Heavy−Light and Spiked−Flat axes.
- Shop list: enum 4379 points to structs.
  - Param 1636 is the item, 1637 the mould and 1638 the cost.

**Room locs** (`dump:loc`)

| Loc | Id | Tile |
| --- | --- | --- |
| trip hammer | 44619 | (3363, 11496) |
| grindstone | 44620 | (3361, 11491) |
| polishing wheel | 44621 | (3362, 11484) |
| lava pool | 44631 | (3372, 11497) |
| waterfall | 44632 | (3357, 11488) |
| bank chest | 44630 | (3375, 11493) |
| crucible multiloc | 44776 | (3373, 11488) |
| mould jig multiloc | 44777 | (3370, 11488) |
| preform storage multiloc | 44778 | (3369, 11501) |
| quest crate multiloc | 44779 | (3370, 11483) |

## Captured behaviour

**The room**
- Everyone inside hears area sounds 5602 at (3364, 11485) and 5600 at (3363, 11492) every second tick.
- Every fifth tick, sound 5603 plays at (3367, 11497) and `giants_foundry_hammer01` (9446) plays on the trip hammer and its belt system (44763).
- The loc animations that appear around each station are all this one loop.

**Login** re-sends every foundry varbit and varp 3436, wherever the player logs in. The state persists: a stored preform keeps its temperature between sessions.

**Preform storage** (recording 101)
- Store-preform:
  - plays `human_furnace` (899);
  - says "<col=229628>You place the preform in the handy storage area. It should stay nice and warm there.";
  - removes the worn preform and sets 13947 to 1;
  - resets the combat tab header and closes the HUD.
- Take-preform does the reverse, with "You take the preform from the handy storage area. It will start to get cold now."

**Commissions** (all four recordings)
- Commission (op4) sets 13907/13908 on the click's tick, then Kovac says "Make <col=ef1020>Light Spiked</col> sword.".
- The first word is Broad, Narrow, Heavy or Light; the second is Heavy, Light, Flat or Spiked; they never share an axis. That gives twelve pairs, eleven of them seen.
- With a commission, Commission answers "Kovac give commission already. Go make me … sword." (Wiki transcript).

**Mould setup** (all four recordings)
- The jig's Setup:
  - opens 718 in the main modal after `toplevel_mainmodal_open [-1, -3]`;
  - sets OP1 events on side_menu (0-63) and content (0-544).
- A side_menu click is tab `sub / 9`; a content click is part `sub / 17 + 1`. Each is answered with its varbit on the same tick.
- The list is in enum order (script 6096 does not sort it).
- Picks are checked as script 6100 does: the mould is bought (script 6099's varbit, for the five highest struct ids of each kind) and the player's Smithing level is at least param 1622.
- Set: mould_state 0→1, and 718 closes. Without a commission, a message box says "You need a commission before you can set up the mould." (recording 96).
- Score (script 6105):
  - Each part scores, for each commission word, the size of its stat on that word's end of the axis.
  - Example (recording 565): Spiker! + Choppa! + Serrated Tip for Light Spiked score 22 + 22 + 16 + 4 = 64. With the alloy's 20, that gives the captured start quality 84.

**The crucible** (recordings 96 and 565)
- Fill opens the make-x menu "What metal would you like to add?" with the six bars; its quantity cap is the space left.
- A bar the player doesn't hold gets an item box: "You have no Bronze bars to add to the crucible.".
- Item-on asks "How many would you like to add?" with 1, 5, X and All (one item: no question).
- Then the player pulls the lever (4909, synth 2725). Three ticks later:
  - the metal count and crucible state change;
  - an item box says "You add 6 Iron bars to the crucible." or, for equipment, "You add 7 Bronze platelegss to the crucible,<br>worth 14 Bronze bars.". Live adds an "s" to the item name even when it already ends in one.
- When the metal would overflow, it asks first ("No./Yes."): "Adding this item will overflow the crucible. You will lose 12 bars worth of Steel. Are you sure you want to add it?".
- After the box:
  - if the crucible is full, a message box says "The crucible is now full of molten metal, it is ready to be poured into the mould jig.";
  - otherwise the game message "You need to add 10 more metal bars worth of material to pour the crucible into the mould jig.".
- Pour:
  - The player pushes (810, synth 5605) and the crucible plays 9447.
  - The next tick sets alloy difficulty (13913) to the metal score.
  - Six ticks after the push, the jig goes 1→2, the counts clear and the crucible empties.
  - Without a set-up jig, the player says "I'll need to set the mould up before pouring metal into it."
- Metal score (Wiki):
  - Vₙ = 10·tier·amount/28 for the two most common metals, ties going to the better metal.
  - Score = ⌊(⌊10V₁⌋ + ⌊10V₂⌋ + ⌊V₁V₂⌋)/10⌋.
  - 14 bronze + 14 iron score 20, as captured.

**Picking up the preform** (recording 565)
- The jig goes 1→2 on pouring and 2→3 two ticks later.
- On pickup:
  - "Your Ice gloves cool the preform as you reach for it." on the spam channel (recordings 96, 100, 101, 565);
  - preform difficulty, quality and start quality are set;
  - seeds 1-6 are set, temperature becomes about 990, and alloy difficulty and the selected parts clear;
  - the jig returns to 0;
  - the preform is worn in the weapon slot, synth 1051 plays, and the combat tab header becomes "Preform" ("Category: Unarmed");
  - HUD 754 opens in the overlay slot.

**Working the preform** (all four recordings)

| Machine | Every | Completion | Temperature | Sound | Animation |
| --- | --- | --- | --- | --- | --- |
| Trip hammer | 5th tick | +20 | −25 | 5601 | `human_preform_lift_start02`, then `_loop02` every tick |
| Grindstone | 2nd tick | +10 | +15 | 5604 | `human_preform_lift_start`, then `_loop` |
| Polishing wheel | 2nd tick | +10 | −17 | 5608 | the same |

- The stage is script 6120's: completion × stages / 1000.
- A machine tick damages the preform when the stage needs another tool, or when the temperature is outside the tool's 6121 zone. A damaging tick:
  - makes no progress, but its temperature step still applies;
  - costs 5 quality and plays synth 2724, with no message.
  - The Wiki's quality section says 10 and its rewards section says 5; every capture shows 5.
- Sweet spot:
  - It opens on a machine tick (script 6122 [1]).
  - Clicking the machine inside it sends [2], then [0]. The machine works at once with 50 extra completion, synth 2192 and "<col=229628>Your quick reactions allow you to find the perfect position to work the preform!".
  - Unclicked, it clears after 9 ticks.
  - The Wiki adds that the hit wins back one unit of lost quality and doubles the next tick's XP.
  - Count per sword (Wiki): three for 6-7 sections, otherwise two. Each goes in its own stage, a little way into it.
- Clicking the machine again outside a sweet spot: "<col=ff3045>Your attempt to overwork the preform causes you to miss the action altogether."; the next tick does nothing.
- XP per machine tick (Wiki): 4.5 trip hammer, 3.2 grindstone, 3.3 polishing wheel.
- Smiths' uniform (Wiki): each piece gives a 20% chance of 5% more progress on the trip hammer and 10% more on the others. That is the 21 and 11 in the recordings where the player wore it.
  The full set gives 100% ("with the whole outfit giving a 100% chance"). The chance is `smithsUniformChance` in `Common.Smithing.js`, shared with the anvil's 4-tick chance.
- At 1000 the player says "Looks like the sword is finished. I should take it to Kovac.".

**Temperature**
- Dunk-preform and Quench-preform step every tick. The step grows: 27, 30, 33, 37, 41, 45, 49, 53, 57, 62, 67, 72, 77, 83, 89.
  - Lava: `human_pickupfloor` with synth 1019.
  - Waterfall: `human_pickuptable` with synth 1006.
- A worn preform loses a degree every second tick, also while it is heated or worked.

**Hand-in** (recording 101)
- Kovac: "Hmm... sword look good. Hand over.". On continuing:
  - "Kovac deposits 46,020 coins into your bank as payment.";
  - varp 3436 rises;
  - the preform and commission varbits clear and the preform leaves the weapon slot;
  - jingle 293 plays and the HUD closes;
  - a message box shows "Sword completed in: 52m 10s at quality: 188<br>Best completed in: 5m 8s at quality: 199<br>You're awarded: 23010 Smithing XP and 46,020 coins.<br>Total swords made in the Giants Foundry: 31".
- Then the game message "Total swords made in the Giants Foundry: 31" and "Receive another commission?" (Yes./No.).
- Rewards (Wiki):
  - XP = (⌊q²/73⌋ + ⌊1.5q⌋ + 1) × 30; quality 188 gives 23,010, as captured.
  - Coins = 2 × XP.
  - Foundry Reputation = quality. Leagues V multiplied it by 8 in the capture.
  - Half the run energy comes back.
  - A ruined sword gives 30 XP and 60 coins.
- The collection log's "Giants' Foundry" count is the number of swords made.

**Reward shop** (recording 96)
- Shop (op5), and Talk-to's "I'd like to buy something.":
  - opens 753 after `toplevel_mainmodal_open`;
  - sets OP1-OP4 on the list (0-312) and OP1 on the filter dropdown (0-12);
  - runs `reward_shop_init` (6082).
- A list entry is 13 components.
  - Op1 on sub `s` selects entry `s / 13 + 1` (varp 3435).
  - On items, op2-op4 buy 1, 5 or 10.
  - The stock is enum 4379's structs: param 1636 item, 1637 mould, 1638 cost.
- Buy buys the selected entry.
  - An item: varp 3436 drops, "Kovac hands you your reward." and synth 2114. Purchases log in the collection log.
  - A mould: its unlock varbit is set and the selection clears, then varp 3436 drops, "Kovac hands you a mould, which you add to the library of moulds you already have stored here." and synth 2114.
  - Short of reputation: "You do not have enough Foundry Reputation to buy that.".
- A filter option is dropdown component 1 + 2i. It sets 13915 to i and clears the selection (script 6085).

**Rewards**
- Ore pack (Open):
  - "You open the pack and find 30 ores.";
  - 30 noted ores, each rolled with the Wiki's rates: coal 81.64%, iron 10.11%, mithril 6.45%, adamantite 1.52%, runite 0.28%;
  - "You will need another free inventory space to open the pack." when there is no room (recording 96).
- Kovac's grog (Wiki):
  - heals 1, Smithing +4, Attack, Ranged and Magic −2;
  - "You drink Kovac's grog. It tastes like giants' feet.";
  - leaves a beer glass.
- Using items on Kovac (Wiki transcript):
  - He buys back the uniform, the double ammo mould, the catalyst and the ore pack for 80%: "Ore pack: Kovac will give you 160 Foundry Reputation for this." then Accept/Decline.
  - He refuses the colossal blade and the grog with their lines.
  - Anything else gets "You keep that.".

**Stage seeds** (54 captured preforms)
- Stage 0 is always the trip hammer.
- Each later stage is one of the two tools that differ from the stage before it, chosen at random.
- Unused seeds are 0.

## Not captured

- The reward shop when the inventory is full, and the double ammo mould without Dwarf Cannon (the Wiki says it needs the quest): placeholder messages.
- The grog's Ironman line when used on Kovac is not played.

- The crucible's Check and Empty: Check reports its contents, and Empty asks before destroying them (Wiki: emptying loses the metal).
- Pouring while a preform is still to be handed in (the Wiki says it can't be done): a placeholder message.
- The level check for adding a metal (the Wiki says it needs the smelting level, boostable): a placeholder message.
- Picking the preform up with a bucket of water (every capture used ice gloves): the bucket is emptied, with a placeholder message.
- Heat-preform and Cool-preform (every capture went straight to the fast options): steps a third of the fast ones.
- The temperature at pickup is 1000 minus a degree per tick since the pour (captured: 980-998).

- "Check" on a set-up jig: it reopens the setup.

- The refusal when the preform is unequipped anywhere but the storage: it is refused silently.
- Store-preform with no preform worn, and Take-preform with nothing stored: placeholder messages.

## Rewards outside the minigame

- Smithing catalyst (`Smelting.Smithing.js`, Superheat Item): for a bar that uses coal, one catalyst per bar halves the coal and doubles the Smithing XP. When there aren't enough catalysts or coal for that, the bar is smelted as normal. At the [Blast Furnace](./blast-furnace.md#smithing-catalyst), it doubles XP without further coal savings.
- Double ammo mould: `Cannonballs.Smithing.js`.
- Smiths' uniform at an anvil (`Anvil.Smithing.js`): each item takes 4 ticks instead of 5 at the same chance.
- Colossal blade (`ColossalBlade.EquipmentEffects.js`): the melee max hit is raised by 2 × the target's size, at most 10.

## Follow-ups

- Combat achievements, diaries and the minigame's league tasks.
