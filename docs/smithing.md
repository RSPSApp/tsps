# Smithing

Smelting at furnaces and smithing at anvils (`server/plugins/skills/Smithing.plugin.js`, units in `server/plugins/skills/smithing/`). Behaviour is from the OSRS Wiki and rsprox captures (https://rsprox.net/database); recording ids are given where a fact comes from one. Facts with no capture behind them are marked **(Wiki)** or **(unverified)**.

## Where the data comes from

- **Anvil products come from the cache.** Enum 846 maps a product to its level, 845 to its bars and 844 to the amount made. Interface 312 draws its own products: client script 430 switches on varbit `smithing_bar_type` (enum 1253: 1 bronze ... 6 runite, 7 lovakite) and lays the slots out, hiding claws until Death Plateau (varp 314), greying out dart tips until The Tourist Trap, and showing bolts, limbs, javelin tips and keel parts only on members worlds (keel parts after Pandemonium, script 9022).
- **`yarn dump:smithing`** reads that layout out of script 430 into `server/plugins/skills/data/smithing-anvil-layout.json` (component, product obj, label, members, quest). `yarn dump:smithing --check` exits 1 when the cache no longer matches it. There is no enum or table with the layout.
- **`server/plugins/skills/data/smithing.json`** holds what the cache doesn't: furnace recipes and their messages, experience (per bar, Wiki), the "You hammer the ..." phrases, cannonballs, blurite products and barbarian spears.
- Enum 1101 maps a product component to the 1-based slot index varbit `smithing_item_lasttype` holds.

## Smelting

- **Smelt** on a furnace opens the shared skillmulti menu (`CreationMenu`) titled "What would you like to smelt?", listing Bronze, Blurite, Iron, Silver, Steel, Gold, Mithril, Adamantite and Runite: every bar, whatever the player holds, as normal worlds do (recs 69, 73, 83, 91, 331, 3315, rev 227-235). Leagues VI (rev 237) lists only bars the player has ore for; that is left as Leagues behaviour.
- **No ore at all:** message box "You don't have any ore to smelt." (rec 4283).
- **Too low a level:** message box "You need a Smithing level of 40 to smelt a gold bar." (rec 1102).
- **The loop:** on the choosing tick, "You smelt the ... in the furnace." with `human_furnace` (899) and sound 2725; 4 ticks later the ore goes in, the bar comes out with "You retrieve a bar of ..." and the experience; the next ore starts on the 5th tick (recs 1102, 1105, 4308).
  - Messages are the rev 237 wording where captured (bronze, iron, steel, gold, silver). Mithril, adamantite, runite, blurite and lovakite follow the same pattern **(unverified)**.
  - Iron fails half the time: "The ore is too impure and you fail to refine it." The ore is lost, no experience (recs 69, 73, 83, 1102, 3315).
  - Running out mid-loop: "You need at least one iron ore and two coal to smelt a steel bar." (rec 1102); the other bars follow that pattern **(unverified)**.
- **Ore used on a furnace** opens the Smelt menu. Sand or soda ash opens molten glass (Crafting), which gives back the bucket (rec 3432). 'perfect' gold ore opens its own bar; the Gold bar choice also uses it when the player has no normal gold ore.
- **Blurite** needs The Knight's Sword **(Wiki)**. **Lovakite** is smelted only at the Lovakite furnace in Lovakengj (45 Smithing, 1 ore + 2 coal, 20 XP) **(Wiki)**.
- **Coal bag:** a carried coal bag's coal is used after the inventory's (docs/storage-items.md).

## Anvils

- **Smith** opens interface 312 on the bar the player used, or the best carried bar they can make something from, or the lowest carried bar. It sets varbit `smithing_bar_type` and varp `makexcrafting` to the quantity the server will use: the player's remembered choice, or All if they have not chosen one (recs 1102, 1610; [Halloween 2017 & Make-All](https://secure.runescape.com/m=news/halloween-2017--make-all?oldschool=1)). The client highlights All when `makexcrafting >= min(28, bars)` (script 2928), so sending the bar count preselects All while the server smiths one (issue #830).
- **With no bar:** message box "You should select an item from your inventory and use it on the anvil." (recs 321, 1105, 1515, 3315, 4012).
- **A click** sets `smithing_bar_lasttype` and `smithing_item_lasttype`, closes the interface and plays `human_smithing` (898) on the same tick. The first item comes 3 ticks later, then one every 5 (recs 96, 1106, 1610, 3461).
- **Messages:** "You hammer the steel and make ten dart tips." Captured (rev 237+): a platebody, a plateskirt, fifteen arrowtips, ten crossbow bolts, a two-handed sword, ten dart tips, a dagger, an axe, a full helm, a medium helm, a kite shield, a square shield, a pair of plate legs, some keel parts, a mithril grapple tip, a bullseye lantern. The other phrases follow the same style **(unverified)**.
- **Experience** is the bar's rate times the bars used (Wiki: 12.5 bronze ... 75 runite, 60 lovakite). Keel parts take 5 bars (187.5 XP for steel); Shayzien armour (1)-(5) comes from lovakite.
- **Quest and members gates** follow script 430: claws (Death Plateau), dart tips (The Tourist Trap), keel parts (Pandemonium), members-only slots on free worlds.
- **Hammers:** a hammer, or an Imcando hammer carried or wielded in either hand **(Wiki)**.
- **The rusted anvil** in Lumbridge only works bronze. **Doric's anvil** asks Doric's Quest through `smithing:anvil-access`.
- **Blurite** isn't on interface 312: a blurite bar used on an anvil (or Smith with only blurite) opens a menu of blurite bolts (unf) (8 Smithing, 10 a bar) and limbs (13), 17.5 XP each, after The Knight's Sword **(Wiki)**.

## Cannonballs (Wiki, no captures)

- A bar and an ammo mould at any furnace make 4 cannonballs; a double ammo mould takes two bars a time for 8 at the same speed. Bronze 5, iron 20, steel 35, mithril 55, adamant 75, rune 90 Smithing; 8.8 / 17.2 / 25.6 / 34 / 42.4 / 50.8 XP a bar. Needs Dwarf Cannon.
- The Smelt menu offers a cannonball for each bar carried with a mould; a bar used on a furnace opens its own.
- 8 ticks, then 10 between (the Wiki's recipe; its Ancient Furnace page disagrees). The bone-burying animation (827). Messages **(unverified)**: "You heat the steel bar into a liquid state.", "You pour the molten metal into your cannonball mould.", "The molten metal cools slowly to form 4 cannonballs."

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
- **Barbarian spears and hastas** **(Wiki)**: at a barbarian anvil only, a bar and its log (logs, oak, willow, maple, yew, magic): 5/20/35/55/75/90 Smithing, 25-150 XP, 4 ticks. Smith says "You should select a suitable metal bar from your inventory and use it on the anvil."; no hammer: "You need a hammer in order to smith here." (recs 1530, 1533). Barbarian Training isn't on this server yet, so as with the Fishing plugin's quest fish it only locks once it is (or for a player with `barbarian-training:smithing`).
- **Gold helmet** stays with Between a Rock (3 gold bars, 50 Smithing); it now gives its 30 XP.

## Not done

- Smiths' Uniform speed-up, the smithing catalyst, and the Ancient Furnace (Grimstone, Sailing 87).
- Chainshot and incendiary cannonballs, large keel parts, dragon keel parts and dragon nails, granite cannonballs.
- Lunar bars (Lunar Diplomacy / The Fremennik Exiles) and elemental metal outside Elemental Workshop.
- The level-up "You have unlocked: ..." messages.
- Superheat Item still treats blurite as a 13 Smithing bar (the Wiki says 10 by spell).
