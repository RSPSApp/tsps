# Scurrius

Scurrius, the Rat King, in the Varrock Sewers, built from the OSRS Wiki ([Scurrius](https://oldschool.runescape.wiki/w/Scurrius), [Scurrius/Strategies](https://oldschool.runescape.wiki/w/Scurrius/Strategies), [Food Pile](https://oldschool.runescape.wiki/w/Food_Pile), [Historian Aldo](https://oldschool.runescape.wiki/w/Historian_Aldo)) and checked against live rsprox captures (<https://rsprox.net/database>; recordings 75, 83-86, 96, 1839, 1845, 2149-2176, 2183-2188 on revs 227-228 and 3275, 3279 on rev 234). Every Scurrius capture is from a Leagues or event world, so damage numbers and kill times in them are no guide; animations, tiles, timings and messages are. The plugin is `server/plugins/bosses/Scurrius.plugin.js`, with its units in `server/plugins/bosses/scurrius/`.

| File | What it owns |
| --- | --- |
| `Common.Scurrius.js` | Ids, tiles, animations, graphics, sounds, small helpers. |
| `Lair.Scurrius.js` | The broken bars and sewage water, the public lair and private instances, spawns and respawns, the boss HUD. |
| `Fight.Scurrius.js` | The combat method: phases, feeding, the walk to the middle, rubble, rats. |
| `FoodPile.Scurrius.js` | Eating from a food pile. |
| `Kills.Scurrius.js` | Kill count and loot (MVP and non-MVP). |
| `Aldo.Scurrius.js` | Historian Aldo's spine trade and the antique lamp. |

Ticks count from the action named; captured gamevals are in brackets.

## The lair

- **NPCs:** 7221 (`rat_boss_normal`, public, 1500 hitpoints) and 7222 (`rat_boss_instance`, private, 500). Both are 3x3. The rats are 7223 (`rat_boss_giant_rat`, 2x2, 15 hitpoints).
- **Broken bars** (14203, `rat_boss_entrance`) at (3282, 9867): Climb-through (normal), Climb-through (private), Peek (normal). Until the player picks "Yes, and don't ask again." (varbit 9589 `rat_boss_enter_warning` = 1), each climb asks "Are you sure you want to climb through the broken bars? (normal)" (or "(private)") with "Yes.", "Yes, and don't ask again." and "No.".
- **Climbing through:** +0 `human_reachforladder` (828), sound 7655, busy, fade out (174 with script 948 `[0, 255, 0, 0, 50]`); +1 minimap off (6719 = 2); +3 the move to (3290, 9868); +4 minimap back on, fade in, Oh Rats! (777); +6 the overlay closes. A private climb builds the instance and spawns its Scurrius on the move tick.
- **Peek:** "There are no adventurers through the broken bars." (captured). With players inside, "There is 1 adventurer..." and "There are N adventurers..." follow the wording of the other bosses' Peek lines (Nex, the Nightmare, Zalcano); the lair's own were not captured.
- **Sewage water** (14204, `rat_boss_exit`) at (3288, 9867): Cross plays `emote_think` (857) and sound 7655, then the fade, the move to (3279, 9869) on +2 and the fade in with Scape Cave (144) on +4; Quick-escape is the same without the emote.
- **The boss HUD** (interface 303, through the BossHud plugin) shows the room's Scurrius while the player is inside: 1683 = 7221 and 6100 = 1500 in the public lair, 7222 and 500 in an instance.
- **Re-entry:** after the move out over the water, the bars refuse the player for 26 ticks (recordings 83, 86, 2155; Wiki: about 15 seconds) with "You are exhausted after climbing over the broken bars. Please wait for another N seconds." (whole seconds left, rounded down; "another second." for the last).
- **No fires:** "It's far too damp for you to light a fire here." (Wiki), through Firemaking's `firemaking:can-light` event.
- **Graves:** a death in the lair leaves the grave beside Historian Aldo (Wiki), at (3276, 9871) (the tile is an estimate; no capture shows one), through Gravestones' `gravestones:grave-location`.
- **Instances** are a PrivateArea over the lair's tiles. Leaving one (the water, a teleport, death, logging out) ends it with its Scurrius and rats; logging back in after a logout there puts the player outside the water.
- **Respawn:** Scurrius appears at (3301, 9867) facing south with `npc_rat_boss_spawn_01` (10686), and attacks 4 ticks later. He is removed 5 ticks into his death animation (`npc_rat_boss_death_01`, 10705), and the next one comes 30 ticks after that (Wiki: 30; captured 29).
- **Historian Aldo** stands at (3275, 9871), facing south, as 7615 (`rat_boss_biologist_op2`: Talk-to, Trade); varbit 9586 is 1 in every capture, so he is spawned as that variant.

## The fight

| Phase | When | Attacks (captured share) | Speed |
| --- | --- | --- | --- |
| One | Start | Beside his target: tail swipe 10693 (`attack_melee_02`) 80%, stomp 10698 20%. Out of reach: stomp | 4 |
| Feeding | 80% (once) | Magic 10697 with 2639 on him, ranged 10695, stomp 10699, rats 10703 (4:4:2:1) | 6 |
| Two | After feeding | As phase one | 4 |
| Enraged | 30% | Magic 10696 with 2638, ranged 10694, stomp 10698, rats 10706 (2:2:3:1) | 4 |

- **Phase one and two by distance:** the captured shares split by where the player stood when he attacked. Within a tile of him, solo instances show 95 tail swipes to 21 stomps; further away, 46 stomps to 11 swipes. So he stomps from range while walking in (the generic `combat:close-in` flag), and steps round to an edge for the swipe as before. Stomps can follow stomps (a third of the time in phase one, up to five in a row), so nothing stops that. Overall that is still the 7:3 the table used to give.
- **To the food:** at 80% he walks to one of the three piles and stands on (3297, 9873), (3304, 9866) or (3298, 9860), facing it. There he plays the eating idle (10689, sent as a `bas` change on live; here the animation is replayed every 3 ticks) and heals five times, about every six ticks, by 5 or 10 per player in the room (heal hitsplat 6). Then he goes back to melee. Reaching 30% ends the feeding.
- **To the middle:** at 30% he walks to (3298, 9867) and stays there. If he heals above 30% he goes back to eating (Wiki).
- **His walks** pause his attacks. Players in his way don't block him and hits don't stop him (the generic `combat:no-retaliate` flag), and he faces where he walks. While he eats he keeps facing the pile, attacks included (captured: his facing is re-sent with each heal), through a new generic `combat:keep-facing` flag in Combat.
- **Magic and ranged:** projectiles 2640 and 2642, cycles 30 to 120, height 200 to 100, angle 40, progress 0 (rev 234). The hit lands 4 ticks after the cast, whatever the distance. Cast sounds 7700 (magic) and 7722 (ranged); impacts 2641 and 2643 on the player. Melee lands on the swing's tick.
- **Max hits (Wiki):** solo 13 melee, 8 magic, 7 ranged, 15-22 rubble; public 13, 14, 13 and 15-24.
- **Rubble:** twelve tiles (12 in 641 of 989 captured stomps, fewer where they overlapped), always one under each player and the rest anywhere on the floor (x 3290-3306, y 9860-9875). Each tile gets 2644 (`vfx_rat_boss_falling_debris_01`) with delay 60 and the area sound 4175 (delay 240, range 5); the stomp itself plays area sounds 7699 and 7667 at the middle of the room. Rubble hits land 9 ticks after the stomp, on players who stood on a rubble tile at the end of the tick before. Across the 29 recordings with stomps, 68 of 93 such players were hit on that tick, against 1 of 437 at 5 ticks. The falling sound's 240-cycle delay (8 ticks) agrees. It used to be 5 ticks, so the hit came about four ticks before the rock.
- **Rats:** six at once, two ticks into the call, on random floor tiles; at most twelve waves (Wiki), and calls at least 41 ticks apart (the shortest of 27 captured gaps). The enraged call also plays area sound 7717 (delay 90). Any player's hit kills a rat, and rat bone weapons hit them without an attack delay (Wiki). They stay after Scurrius dies.

## Loot and kill count

- "Your Scurrius kill count is: <col=ff0000>N</col>." for everyone who damaged him, on the tick the loot drops (varp 4079 `total_rat_boss_kills`, through Combat Achievements).
- The loot lands on his middle tile. In an instance, and for the top damager in the public lair, it is the MVP table (`scurrius` in `npc-drops.json`); everyone else who helped in the public lair rolls the non-MVP table (`scurrius_2`), each seeing only their own.
- Only one player gets a spine per kill (Wiki): the top damager's roll first.
- Ironmen in a group kill get only medium clue scrolls (Wiki): the Ironman plugin's shared-kill rule asks `ironman:shared-kill-keeps`, and Scurrius keeps the clue. Each helper's share goes through `npc-drops:roll` like the killer's, so the rule and the collection log see it.

## Food piles

- 14205 and 14206 ("Food Pile", Eat), 2x2 each: north (3298, 9876), east (3307, 9867), south (3298, 9858).
- Out of combat, once every ten minutes: +0 `human_pickupfloor` (827); +1 `human_eat` (829), sound 2393, "You take food from the food pile and eat it, restoring your hitpoints.", hitpoints to full, varbit 9581 (`rat_boss_food_pile_player_eat_delay`) = 10, counting down a minute at a time.
- Refusals: "You cannot eat from the food pile while in combat.", "You ate from the food pile recently. The foul stench prevents you eating from it for another # minutes." and "You already have full Hitpoints.".

## Historian Aldo

- Talk-to plays his Wiki transcript (`npc-dialogues.json`).
- Trade, or a spine used on him (after "Ah, a Scurrius spine! A captivating subject indeed..."): with no spine, "Ah, I'll need one of Scurrius' spines to do that. Perhaps you could fetch me one?"; with one, "Trade Scurrius' spine for a combat lamp?"; with several, "Trade ALL your Scurrius spines for combat lamps?". Yes swaps every spine for an Antique lamp (28800) with "Aldo gives you an Antique lamp for Scurrius' spine." (or "some Antique lamps for Scurrius' spines.") in an item box.
- The lamp (Rub): "Choose the skill you wish to gain XP in." with "Attack.", "Strength.", "Defence.", "Prayer.", "More options...", then "Ranged.", "Magic.", "Hitpoints.", "Previous options...". 5,000 experience, or 3,500 in Prayer, with sound 2655 and "<col=0000ff>Your wish has been granted!</col><br>You have been awarded 5,000 Defence XP!".

## Rat bone weapons

`server/plugins/items/RatBoneWeapons.plugin.js`, with units in `server/plugins/items/ratboneweapons/` (Wiki: Bone mace, Bone shortbow, Bone staff, Rat bone weapons; captured in recordings 86, 2152-2156).

- **Rats:** the Wiki's rat attribute list, by name, in `server/plugins/items/data/rat-bone-weapons.json` (Blessed giant rat, Brine rat, Crypt rat, Dungeon rat, Giant crypt rat, Giant rat, Rat, Scurrius, Zombie rat), since the monster dump has no rat attribute; a future dump's `rat` attribute counts too.
- **In a fight:** anything else is refused with "You can only use this weapon against rats." (captured), and melee and ranged get +10 maximum hit against rats (Wiki). Against Scurrius' rats there is no attack delay (the Scurrius plugin).
- **Making them yourself:** 300 experience each.

| Weapon | How | Level | Animation | Message when a tool is missing |
| --- | --- | --- | --- | --- |
| Bone mace (28792, `rat_bone_mace`) | Spine on an anvil, with a rune mace and a hammer | 35 Smithing | 898 `human_smithing` | "You'll need a hammer to do that." |
| Bone shortbow (28794, `rat_bone_bow`) | Yew shortbow with the spine, and a knife | 35 Fletching | 6682 `stringing_yew_shortbow` | "You'll need a Knife to do that." |
| Bone staff (28796, `rat_bone_staff`) | Battlestaff with the spine, 1,000 chaos runes and a chisel | 35 Crafting | 7531 `human_battlestaff_crafting`, graphic 2637, sound 2585 | "You'll need a Chisel to do that." |

  Success shows "You attach the Scurrius' spine to the Yew shortbow to create the Bone shortbow." (and so on) in an item box. The spine used on a rune mace says "I should probably smith this at an anvil..."; a staff without the runes "You need 1,000 chaos runes and a Scurrius' spine to create the Bone staff.". The low-level message ("You need a Crafting level of 35 to do that.") was not captured.
- **Historian Aldo** makes any of them for 50,000 coins, with no level or tool, through his Talk-to transcript: its materials conditions are answered, and "Aldo handed the Bone mace to you." takes the fee and materials and shows the weapon. Without them for the chosen weapon he says "Come back when you have all the necessary materials.".
- **The bone staff** holds the 1,000 chaos runes it was made with as charges, up to 20,000, one a cast.
  - Chaos runes on it ask "How many chaos runes do you wish to add? (0 - N)"; when full, "Your Bone staff is already fully charged.".
  - Check: "Your Bone staff has N charges remaining.". Uncharge: "You uncharge your Bone staff." in an item box, returning the runes, or "Your Bone staff has no charges to remove.".
  - Its spell (Wiki): max hit floor(Magic / 3) + 5, plus the +10; attack speed 4; 8 tiles; 35 base Magic experience on a successful hit. That experience is added by the plugin, since the engine doesn't add combat spells' base experience.
  - Captured cast: animation 393, graphic 2645, area sound 7617, and projectile 2647 (cycles 46 to 46 + 10 a tile, height 45 to 23, angle 10, progress 64). The impact is 2646 at height 124. Every cast also sends "Your weapon has N charges remaining.". That was captured on a Leagues world that never used up charges (always 20,000), so how often live sends it is unconfirmed.
  - "Your Bone staff has no charges left." for an empty staff was not captured.

## Not built

- Aldo's Trade offering a bone weapon or a lamp when the player has the materials for one ("Trade your Scurrius spines for a bone weapon or combat lamp?"); his Trade only swaps spines for lamps.
- The feeding damage reduction ("slight", no number on the Wiki; the captures are all Leagues, so their damage can't give one).
- The patrol rats in the sewers outside (7224, 7225), which are scenery.
