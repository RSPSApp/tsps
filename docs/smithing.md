# Smithing

Smelting at furnaces and smithing at anvils (`server/plugins/skills/Smithing.plugin.js`, units in `server/plugins/skills/smithing/`). Behaviour is from the OSRS Wiki and rsprox captures (https://rsprox.net/database); recording ids are given where a fact comes from one. Facts with no capture behind them are marked **(Wiki)** or **(unverified)**.

## Where the data comes from

- **Anvil products come from the cache.** Enum 846 maps a product to its level, 845 to its bars and 844 to the amount made. Interface 312 draws its own products: client script 430 switches on varbit `smithing_bar_type` (enum 1253: 1 bronze ... 6 runite, 7 lovakite) and lays the slots out, hiding claws until Death Plateau (varp 314), greying out dart tips until The Tourist Trap, and showing bolts, limbs, javelin tips and keel parts only on members worlds (keel parts after Pandemonium, script 9022).
- **`yarn dump:smithing`** reads that layout out of script 430 into `server/plugins/skills/data/smithing-anvil-layout.json` (component, product obj, label, members, quest). `yarn dump:smithing --check` exits 1 when the cache no longer matches it. There is no enum or table with the layout.
- **`server/plugins/skills/data/smithing.json`** holds what the cache doesn't: furnace recipes and their messages, experience (per bar, Wiki), the "You hammer the ..." phrases, cannonballs, blurite products and barbarian spears.
- Enum 1101 maps a product component to the 1-based slot index varbit `smithing_item_lasttype` holds.

## Smelting

- **Smelt** on a furnace opens the shared skillmulti menu (`CreationMenu`) titled "What would you like to smelt?", listing Bronze, Blurite, Iron, Silver, Steel, Gold, Mithril, Adamantite and Runite: every bar, whatever the player holds, as normal worlds do (recs 69, 73, 83, 91, 331, 3315, rev 227-235). Leagues VI (rev 237) lists only bars the player has ore for; that is left as Leagues behaviour.
- **Neither ore nor complete glass ingredients:** message box "You don't have any ore to smelt." (rec 4283).
- **Too low a level:** message box "You need a Smithing level of 40 to smelt a gold bar." (rec 1102).
- **The loop:** on the choosing tick, "You smelt the ... in the furnace." with `human_furnace` (899) and sound 2725; 4 ticks later the ore goes in, the bar comes out with `human_furnace` again, "You retrieve a bar of ..." and the experience; the next ore starts on the 5th tick (recs 73, 83, 1102, 1105, 1106, 4308). The smelt, retrieve and impure-ore lines are on the spam channel.
  - Messages are the rev 237 wording where captured (bronze, iron, steel, gold, silver). Mithril, adamantite, runite, blurite and lovakite follow the same pattern **(unverified)**.
  - Iron fails half the time: "The ore is too impure and you fail to refine it." The ore is lost, no experience (recs 69, 73, 83, 1102, 3315).
  - Running out mid-loop: "You need at least one iron ore and two coal to smelt a steel bar." (rec 1102); the other bars follow that pattern **(unverified)**.
- **Ore used on a furnace** opens the Smelt menu. Sand or soda ash opens molten glass (Crafting). The empty bucket return is captured in recording 4283. 'perfect' gold ore opens its own bar; the Gold bar choice also uses it when the player has no normal gold ore.
- **Furnaces under other names** work as any furnace: the Clay forge (Neitiznot), Volcanic Furnace (Mount Karuulm), Lava forge (Mor Ul Rek), Ancient Furnace (Grimstone Dungeon) and Cam Torum's Forge smelt, take ore, sand and cannonball bars, and open the gold and silver jewellery menus, like a Furnace **(Wiki: Furnace, Clay forge "functionally identical to normal furnaces", Volcanic Furnace, Lava forge, Ancient Furnace, Forge (Cam Torum) "can be used as a regular furnace after the completion of Perilous Moons")**. In rsprox capture 1098 (Leagues, rev 237), Smelt at Cam Torum's Forge opens the same smelting menu as a Furnace. TSPS has no Perilous Moons check on the Forge: the refusal before the quest is unrecorded. The names are in `server/plugins/skills/data/furnaces.json`, shared by Smithing, Crafting and the Desert Treasure II rings. The Ancient Furnace casts cannonballs at 5 ticks an action instead of 10 (Wiki: Ancient Furnace, Cannonball); see Cannonballs.
- **Blurite** needs The Knight's Sword **(Wiki)**. **Lovakite** is smelted only at the Lovakite furnace in Lovakengj (45 Smithing, 1 ore + 2 coal, 20 XP) **(Wiki)**.
- **Lunar bar:** one lunar ore at a furnace makes one lunar bar at level 1 for 6.2 XP **(Wiki)**; Superheat Item picks the recipe up at 43 Magic. "You smelt the magic ore in the furnace." then "You retrieve a lunar bar." (rec 227/01768, duplicated in 227/910302). The missing-ore line follows the pattern **(unverified)**.
- **Coal bag:** a carried coal bag's coal is used after the inventory's (docs/storage-items.md).

### Molten glass

- [Molten glass](https://oldschool.runescape.wiki/w/Molten_glass) specifies members-only furnace crafting at level 1: one sand bucket and one soda ash become one glass, 20 Crafting XP, two ticks per glass. Glass has its own recipe timing rather than the metal bars' five-tick cycle.
- [Furnace](https://oldschool.runescape.wiki/w/Furnace) documents the glass choice when Smelt is clicked with sand and soda ash but no ore. Recording 4283 (revision 239) shows a single pair made directly without a quantity menu, three ticks after arrival. The exchange returns an empty bucket; `human_furnace`, sound 2725 and the spam-channel message "You heat the sand and soda ash in the furnace to make glass." occur together. No glass-specific graphic or variable update is shown in that attempt.
- The existing quantity menu remains for multiple pairs and item-on-furnace use. Recipe membership checks protect the new Smelt route and stale selections. Ordinary ore and cannonball menus retain priority. Walking or losing an ingredient stops production without spending a partial recipe.
- Verification: four added regression tests failed against the original implementation. All 57 Smithing tests pass after the fix, covering glass cadence, synchronized feedback, quantities, XP, buckets, missing ingredients, walking and F2P guards as well as the existing metal-bar cases. Live verification at Falador's furnace covered direct single-pair Smelt, soda ash used on the furnace with quantity two, the remaining single pair, and walking cancellation; each completed glass returned its bucket and awarded 20 Crafting XP.
- Evidence limits: recording 4283 contains only one completed glass, so the repeated two-tick rate and 20 XP use the Wiki. Its indexed XP delta is 5, which does not independently confirm the Wiki's XP award; no XP change is inferred from that recording. The exact multiple-pair menu presentation and visual animation playback were not compared with live OSRS.

## Anvils

- **Smith** opens interface 312 on the bar the player used, or the best carried bar they can make something from, or the lowest carried bar. It sets varbit `smithing_bar_type` and varp `makexcrafting` to the quantity the server will use: the player's remembered choice, or All if they have not chosen one (recs 1102, 1610; [Halloween 2017 & Make-All](https://secure.runescape.com/m=news/halloween-2017--make-all?oldschool=1)). The client highlights All when `makexcrafting >= min(28, bars)` (script 2928), so sending the bar count preselects All while the server smiths one (issue #830).
- **With no bar:** message box "You should select an item from your inventory and use it on the anvil." (recs 321, 1105, 1515, 3315, 4012).
- **A click** sets `smithing_bar_lasttype` and `smithing_item_lasttype`, closes the interface and plays `human_smithing` (898) on the same tick. The first item comes 3 ticks later, then one every 5, each replaying `human_smithing` 15 client cycles into its tick (recs 96, 1106, 1610, 1757, 3461).
- **Above the player's level:** the interface closes with a message box naming the product in title case: "You need a Smithing level of 7 to make a Bronze Full Helm." (rec 68, Leagues V).
- **Messages:** "You hammer the steel and make ten dart tips.", on the spam channel. Captured (rev 237+): a platebody, a plateskirt, fifteen arrowtips, ten crossbow bolts, a two-handed sword, ten dart tips, a dagger, an axe, a full helm, a medium helm, a kite shield, a square shield, a pair of plate legs, some keel parts, a mithril grapple tip, a bullseye lantern. The other phrases follow the same style **(unverified)**.
- **Experience** is the bar's rate times the bars used (Wiki: 12.5 bronze ... 75 runite, 60 lovakite). Keel parts take 5 bars (187.5 XP for steel); Shayzien armour (1)-(5) comes from lovakite.
- **Quest and members gates** follow script 430: claws (Death Plateau), dart tips (The Tourist Trap), keel parts (Pandemonium), members-only slots on free worlds.
- **Hammers:** a hammer, or an Imcando hammer carried or wielded in either hand **(Wiki)**.
- **Calcified deposits** (Wiki): a deposit used on an anvil with a hammer is crushed one at a time, three ticks apart, for 1 Smithing XP each. Three in four give 5-15 blessed bone shards, the rest one calcified moth. The Wiki gives the time and the loot; the loop's first-crush timing and `human_smithing` follow the Barronite Crusher and the anvil loop **(unverified)**.
- **The rusted anvil** in Lumbridge only works bronze. **Doric's anvil** asks Doric's Quest through `smithing:anvil-access`.
- **Blurite** isn't on interface 312: a blurite bar used on an anvil (or Smith with only blurite) opens a menu of blurite bolts (unf) (8 Smithing, 10 a bar) and limbs (13), 17.5 XP each, after The Knight's Sword **(Wiki)**.

## Cannonballs (Wiki, no captures)

- A bar and an ammo mould at any furnace make 4 cannonballs; a double ammo mould takes two bars a time for 8 at the same speed. Bronze 5, iron 20, steel 35, mithril 55, adamant 75, rune 90 Smithing; 8.8 / 17.2 / 25.6 / 34 / 42.4 / 50.8 XP a bar. Needs Dwarf Cannon.
- The Smelt menu offers a cannonball for each bar carried with a mould; a bar used on a furnace opens its own.
- 8 ticks, then 10 between (the Wiki's recipe). At the Ancient Furnace, 5 ticks an action (Wiki); with no figure for its first batch, TSPS pours 4 ticks in, inside the 5-tick action. The bone-burying animation (827). Messages **(unverified)**: "You heat the steel bar into a liquid state.", "You pour the molten metal into your cannonball mould.", "The molten metal cools slowly to form 4 cannonballs."

## Gear (Wiki, no captures)

- **Ring of forging:** iron never fails while it's worn. 140 charges on the player (`smithing:ring-of-forging-charges`), one per ore; at none the ring melts. Check and Break work. Messages **(unverified)**.
- **Varrock armour:** at the Edgeville furnace (loc `varrock_diary_furnace`), a 10% chance of two bars, for bars up to the tier (1: bronze to steel, 2: + mithril and gold, 3: + adamantite, 4: + runite). Both bars give experience **(unverified)**; the message is **(unverified)**.
- **Goldsmith gauntlets** or the Smithing/max cape: 56.2 XP a gold bar.
- Gear can change a furnace result through `smithing:smelt-outcome { player, recipe, furnaceId, success, bars }`.

## Repairs and special smithing

- **Godsword blade** (recs 1515, 1517): Smith with two different pieces, or a piece used on the anvil, shows "You set to work, trying to fix the ancient sword..." with `human_smithing`, again 3 ticks later, and 6 ticks in the pieces become the next one, shown in an item box "Even for an experienced smith it is not an easy task, but eventually it is done.", with 100 XP (80 Smithing). Shards make pairs, a pair and the last shard the blade. "You need at least two different Godsword blade pieces in your inventory to reforge them." / "You'll need a hammer if you wish to repair the Godsword." A hilt used on the blade makes the godsword.
- **Dragon sq shield** (rec 1514): a half used on an anvil shows "You set to work trying to fix the ancient shield. ..."; on continue the hammering starts (twice, 3 ticks apart), 6 ticks later "Even for an experienced armourer ... restored the dragon square shield to its former glory.", and the shield and 75 XP come when that is continued (60 Smithing). "You need to find the other half of this shield in order to repair it." / "You'll need a hammer if you want to attempt to repair this shield." / halves on each other: "You'll need to repair the shield at an anvil, with a hammer."
- **Dragonfire shield and ward** (rec 579, Leagues): Smith (or the visage or shield used on an anvil) with an anti-dragon shield and a draconic or skeletal visage shows the visage and the first message; the hammering starts on continue, again 4 ticks later, and 8 ticks in the uncharged shield is given and shown. 90 Smithing, 2,000 XP **(Wiki)**. The ward's messages follow the shield's **(unverified)**.
- **Dragon forge** (Ancient Cavern, loc `ds2_ac_forge_anvil`), after Dragon Slayer II **(Wiki)**: dragon sq shield + slice + shard → dragon kiteshield (75, 1,000 XP); dragon chainbody + lump + shard → dragon platebody (90, 2,000 XP).
- **Ancient wyvern shield** (Fossil Island, loc `fossil_lab_shield_maker`) **(Wiki)**: wyvern visage + elemental shield, 66 Smithing and Magic, 2,000 XP in each, draining Magic to 0.
- **Barbarian spears and hastas** **(Wiki)**: at a barbarian anvil only, one bar and its matching log (logs, oak, willow, maple, yew, magic): 5/20/35/55/75/90 Smithing, 25-150 XP. Selection opens the barbarian hammering animation; the first output comes three ticks later, then outputs are four ticks apart (capture 224/01530: selection/animation1777, output1780/1784/1788). Smith says "You should select a suitable metal bar from your inventory and use it on the anvil."; no hammer: "You need a hammer in order to smith here." (recs 1530, 1533). Production repeats the cache's barbarian smithing animation (`brut_human_smithing`, 6712), with its Imcando variant when applicable.

### Otto's smithing lessons

[Barbarian Training](https://oldschool.runescape.wiki/w/Barbarian_Training#Smithing) requires Barbarian Fishing, Tai Bwo Wannai Trio, Tamayu's post-quest combat training and a nonboostable base Smithing level of 5. The lesson owner enforces that base level; higher-tier recipe levels continue to accept ordinary current-level boosts. This implementation interprets completed Barbarian Fishing as both existing rod and barehanded-fishing reports. Tai Bwo Wannai Trio completion alone does not substitute for claiming Tamayu's reward. No firemaking requirement is added from the conflicting comment in the local Quest Helper reference.

Otto's spear topic plays the existing Wiki transcript's appropriate quest-condition branch. After the instruction, manufacture a spear on a barbarian anvil and report to Otto; he then offers the hasta instruction. Manufacture a hasta and report again. Reports do not consume the weapons. Each section saves its own 0/1/2/3 stage (untaught/instructed/manufactured/reported) in the existing `barbarian-training` object and synchronizes `brut_smith_spear` (3762) or `brut_smith_hasta` (3763) at login. A carried, bought or withdrawn weapon cannot advance manufacture progress.

`Spears.Smithing` asks `smithing:unlocked` separately for `barbarian_spear` and `barbarian_hasta`. An unanswered request denies crafting; discovery of a registered whole miniquest is not a permission. The obsolete unwritten `barbarian-training:smithing` boolean does not fabricate either lesson. Permission is checked again when selecting a product and on every production tick. The existing two-entry menu remains; choosing an untaught hasta refuses without spending materials.

The action keeps its original anvil, player tile, area and teleport serial through selection and production. Moving, teleporting away and back, losing permission/materials/hammer, or disconnecting cannot spend a later pair of inputs. It consumes unrestricted current bar/log slots, checks capacity after consumption and then grants the product, XP and compatible `smithing:success` event with `source: "barbarian-anvil"` and station provenance. Kandarin diary listeners keep their existing item event.

Evidence limits: capture 237/01149 ticks 9533-9536 shows the Tai Bwo Wannai refusal. Capture 227/910394 shows the successful instruction but is Leagues V. No normal-world capture establishes the precise fishing conjunction or smithing lesson/report stage boundary. Recording progress when the required final NPC reply starts is an explicit choice consistent with the established rod lesson; missing or truncated instructions fail closed. This slice does not add Zamorakian conversion, equipment requirements or whole-miniquest completion aggregation.

`server/tests/barbarian-smithing-native.test.cjs` exercises actual Player, Inventory, map anvil, NPC dialogue packets, CreationMenu, Smithing task, Tamayu reward transcript and PlayerSave codec/apply/login. Controlled quest/fishing prerequisite setup is distinguished from the reward and manufacturing paths actually exercised. Existing training, rod, smithing and Kandarin diary tests cover affected consumers; the full suite is not required for these plugin-local changes.

A rendered native walkthrough verified both complete instruction/craft/report paths, separate untaught-hasta refusal, selection animation and first output at +3 ticks, actual walking before the delayed output with no material or XP cost, and completed stages/weapons/XP after native Logout, a committed SQLite read and fresh browser login. Fishing/quest/Tamayu prerequisites, base level and starting materials were controlled setup. Native early close covered the initial player question; intermediate instruction-close behavior has focused real-packet coverage. One initial cancellation helper never issued a walk and produced a valid spear; it is retained as a helper limit, with the subsequent native hasta walk supplying cancellation evidence.
- **Gold helmet** stays with Between a Rock (3 gold bars, 50 Smithing); it now gives its 30 XP.

## Not done

- Smiths' Uniform speed-up, the smithing catalyst, and the Ancient Furnace (Grimstone, Sailing 87).
- Chainshot and incendiary cannonballs, large keel parts, dragon keel parts and dragon nails, granite cannonballs.
- Elemental metal outside Elemental Workshop.
- The level-up "You have unlocked: ..." messages.
- Superheat Item still treats blurite as a 13 Smithing bar (the Wiki says 10 by spell).
