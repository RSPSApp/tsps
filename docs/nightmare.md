# The Nightmare and Phosani's Nightmare

The Nightmare (https://oldschool.runescape.wiki/w/The_Nightmare) and Phosani's Nightmare (https://oldschool.runescape.wiki/w/Phosani%27s_Nightmare), built from rsprox captures (https://rsprox.net/database), the OSRS Wiki and the cache. One plugin, `server/plugins/bosses/Nightmare.plugin.js`, with one unit per part in `server/plugins/bosses/nightmare/` and its data in `plugins/bosses/data/nightmare.json`.

The captures are all from Leagues V/VI and Grid Master worlds (revisions 227-237). They are trusted for packets, animations, graphics, sounds, messages and timing; damage, accuracy and drops come from the Wiki. Recordings used: 552, 553, 554, 555, 559, 563, 564, 1148, 1757, 1764, 1875, 3284, 3346, 3350, 3389.

## Layout

| File | What it owns |
| --- | --- |
| `Common.Nightmare.js` | The data, saved attributes, fades, sounds, projectiles, styled hits and typeless damage. |
| `Dream.Nightmare.js` | The dreams (instances): Disturb and the Pool of Nightmares, the trip in and out, logging out, dying. |
| `Fight.Nightmare.js` | A fight: countdown, waking, phases, her shield, the totems' blast, her blast form, the HUD, her death, kill counts. |
| `Attacks.Nightmare.js` | Her magic, ranged and melee attacks and the prayer rules. |
| `Specials.Nightmare.js` | Which special when, her curse, the spores' drowsiness. |
| `Claws.Nightmare.js` | Grasping Claws, single and Phosani's chained runs. |
| `Husks.Nightmare.js` | Husks and the trance. |
| `Flowers.Nightmare.js` | Corpse Flowers. |
| `Parasites.Nightmare.js` | Parasites, weakening them, and what they do once out. |
| `Spores.Nightmare.js` | Spores. |
| `Surge.Nightmare.js` | Surge. |
| `Totems.Nightmare.js` | The four totems, their charge, the HUD's totem overlay and their blast. |
| `Sleepwalkers.Nightmare.js` | Sleepwalkers and her blast between phases; Phosani's desperation sleepwalkers. |
| `Loot.Nightmare.js` | Who gets loot and where it lands. |
| `Sanctuary.Nightmare.js` | The Pool of Nightmares, Sister Senga's introduction, Shura's and Senga's Collect. |
| `Retrieval.Nightmare.js` | Shura and Sister Senga keeping what a death leaves behind. |
| `CombatAchievements.Nightmare.js` | Kill counts and best times for Combat Achievements. |
| `Commands.Nightmare.js` | Developer commands. |

Two small generic changes outside the plugin: `api.registerNpcCombatOption(option)` makes an NPC menu option other than "Attack" start a fight (the totems' "Charge"; spells can then be cast on them too), and NpcDrops' `"npc-drops:roll-table"` takes `npcId` to roll that NPC's own table (every eligible player in a group gets a roll). `data/definitions/npc-combat-defs.json` gives every form of both bosses, the totems, husks, parasites and sleepwalkers their captured animations (none for her and the totems; the minions' deaths), so the engine's human block animation never plays on them.

## The way in

| Step | What happens | Source |
| --- | --- | --- |
| The sleeping Nightmare (9460), Disturb | "You are about to begin an encounter with the Nightmare. Dying during this encounter will not be considered a safe death. Are you sure you wish to begin?", then "Are you sure you wish to begin?" Yes. / Yes, and don't ask again. / No. | capture |
| Pulled in | "The Nightmare pulls you into her dream as you approach her." (no continue), sleep animation 8584, sound 4311, `fade_overlay` [0, 200, 0, 0, 50]; minimap off a tick later; on the third tick the move to (3873, 9948, 3) in the dream with wake animation 8583; a tick later the multiway indicator, minimap on, sound 4306, fade in [0, 0, 0, 255, 50], and the box again with a continue. Varbit `nightmare_first_entry` (10137) turns Shura into her Collect variant. | capture |
| The dream | 8x8 chunks from chunk (480, 1240), planes 0-3, unturned (the capture's `rebuild_region` sends 12x12; ours holds every plane-2 and -3 chunk). | capture |
| The Nightmare's dream | Shared: the first player starts it and anyone may join until she wakes, then it is closed until the fight ends (Wiki). | Wiki |
| Countdown | "The Nightmare will awaken in 30 seconds!" then 20, 10, 5 (50, 33, 17 and 8 ticks before she wakes). | capture |
| The Pool of Nightmares | Multiloc 29710 shows Drink-from while varbit `nightmare_challenge_enabled` (10237) is 1, set at login: open to all since August 2022 (Wiki). The first drink plays Sister Senga's introduction as captured (setting varbits 12419 and 10240); later ones the Phosani warning, "The Nightmare pulls you into Phosani's dream as you drink from the pool.", and a 10-second countdown. Phosani's dream is the player's own. | capture |
| Energy Barrier | Pass-through (or Escape during the fight): "Are you sure you want to leave?", then "You pull yourself out of the dream." with the portal overlay (634, scripts 2893/2894) and the move to (3808, 9756, 1) (Phosani's: by the Pool). | capture |

Logging out in a dream puts the player back in the sanctuary. A death in one wakes them by the Pool of Nightmares (Wiki, August 2025); their items stay with Shura (Sister Senga for Phosani's: "Sister Senga has retrieved some of your items. You can collect them from her in the Sisterhood Sanctuary.") for a flat 60,000 coins (Wiki). Collect, or "Do you have any of my items?" in their transcripts, hands them back.

## The fight

| Moment | What happens | Source |
| --- | --- | --- |
| She wakes | "The Nightmare has awoken!", animation 8611, the barriers turn to their fight variant (37731), music 2941 (The Bane of Ashihama). Six ticks later the boss HUD with her shield (colours 132/623/853); two later her phase form, and she attacks. | capture |
| Shield | 2,000, +200 a player past five, at most 19,600; Phosani's 400. Hits show as hitsplat 18 and on headbar 13 (140 wide). | Wiki; capture |
| Shield fails | "As the Nightmare's shield fails, the totems in the area are activated.", her weak form, totems ready (Charge), the HUD on her 2,400 hitpoints (3,200 Phosani's) in the usual colours, the totem overlay (413) in the HUD's side slot, sound 4320. Hits on her: "Your attacks have no effect on the Nightmare." | capture |
| Totems | 300 each (+30 a player past five, at most 2,640; Phosani's 200); magic charges twice as fast. Hitsplat 22, headbar 36 (100 wide), script 3315 per change. "That totem is already charged."; Phosani's also "The south east totem is fully charged." | Wiki; capture |
| Blast | "All four totems are fully charged.", each fires 1768 at her (30-92), impact 1769; three ticks later a third of her hitpoints (800; Phosani's 1,066/1,067, her last leaving 1), the totems sleep, the overlay fades (script 3323). | capture |
| Blast form | She leaves (8607) a tick later, two after that comes back at the centre in her blast form (8610). Two ticks on: "The Nightmare begins to charge up a devastating attack." and sleepwalkers by the totems (8 captured tiles) walking to her from their fourth tick. She blasts 11 ticks after they rise (13 Phosani's), the impact (1782) lands four later and hurts two after that; nine ticks after her animation, "The Nightmare restores her shield." and her next form. | capture |
| Blast damage | 5 with none absorbed, 5 + 144 x absorbed / spawned otherwise (a lone sleepwalker reaching her kills). The Nightmare sends one per player (up to 24), Phosani's 2, 3, 4. | Wiki; capture |
| Her end | Six ticks after the last blast her death animation (8612) and dying form; nine after that her kill count, "Team size: Solo Fight duration: m:ss (new personal best)", the loot at (3870, 9954) and her body (Disturb, the next fight in 10 seconds). | capture; Wiki |
| Phosani's end | "The Nightmare survives the blast!", then after the sleepwalkers "The Nightmare lashes out to survive.": 150 hitpoints, her claws over and over, a sleepwalker every 20 ticks (15 each). Seven ticks after her death "The Nightmare begins to wake..." and she reawakens on a 10-second countdown. | capture; Wiki |

## Her attacks

| Attack | What happens | Source |
| --- | --- | --- |
| Magic | 8595, projectile 1764 three ticks later (0-33, heights 86/31), impact 1765 on the player, the hit on the fourth tick. | capture |
| Ranged | 8596, projectile 1766 three ticks later (0-25), the hit on the fourth. | capture |
| Melee | 8594, the hit two ticks later on anyone under her or beside her on the side she faces; always hits. | capture; Wiki |
| Max hits | 50 melee, 33 magic and ranged; Phosani's 73 and 80. | Wiki |
| Prayer | The Nightmare's land at 20% through the right protection and 120% into the wrong one; Phosani's are stopped by the right one, and in her third phase she switches protections off as she attacks. | Wiki |
| Target | The player with the highest of their five defence bonuses, then Defence level. | Wiki |

## Specials

Between 1 and 5 standard attacks, then a special (capture). The Nightmare's: husks and flowers, then curse and parasites, then spores and surge, mostly alternating with her claws (the capture's order). Phosani's phase forms each name a set (captured): 9416 flowers/parasite/surge, 9417 spores/husks/curse, 9418 flowers/parasite/curse, 11153 spores/husks/surge; a random first, then alternating A (spores, husks) and B (flowers, parasite), each used before any again (Wiki).

| Special | What happens | Source |
| --- | --- | --- |
| Grasping Claws | 8598 and some 40 portals (map animation 1767) at once; four ticks later an area sound (4238) on each and up to 50 to anyone on one or under her (31-43 captured); Phosani's 50-65, gathered around the player. Players her husks hold get none under them. | capture; Wiki |
| Phosani's claw runs | 9102 (delay 12), then 9103 every 5 ticks, five sets of portals, 9104 to finish. With her flowers (9 ticks after the segment) and spores (6 after), and all through her desperation phase. | capture |
| Husks | 8605; two ticks later projectile 1781 at the player; two after that the trance message, the player held, a magic and a ranged husk beside them. The magic one first attacks three ticks after rising, the ranged five, then every 4. The last one dead: "As the last husk dies, you feel yourself become free of the Nightmare's trance." | capture |
| Corpse Flowers | She leaves, is back at the centre two ticks later, segments (8601) three after that. From then: flowers planted on 1, "The Nightmare splits the area into segments!" and their growth on 3, ready on 4, opening on 8, active 9-29. Flies (1783) from each berry line bordering the player every tick, up to 20, healing her twice; hits from that side heal her. | capture; Wiki |
| Curse | 8599 with the screen glow (script 3128), two ticks later "The Nightmare has cursed you, shuffling your prayers!" (script 3129); five of her attacks later "You feel the effects of the Nightmare's curse wear off." In every capture the prayer clicked is the one that turns on, so the shuffle is what each protection stops: Magic stops missiles, Missiles melee, Melee magic (Phosani's the other way round). | capture; Wiki |
| Parasites | 8606; projectile 1770 two ticks later; three after that "The Nightmare has impregnated you with a deadly parasite!" and varbit `parasite` (10151) on. Twenty ticks later it bursts: 40-52 fully grown, 4-9 if a Sanfew serum or Relicym's balm weakened it ("The parasite within you has been weakened."). Out, it heals her shield 31-50 every 4 ticks, or drains the least charged totem, or attacks the player (ranged first). | capture; Wiki |
| Spores | 8600; one of four captured layouts planted a tick later, the message and growth a tick after, armed on the fifth. Within a tile of one: it bursts (8632) and the player is drowsy for 25 ticks (no running, "*yawn*" every 6 ticks, attacks a tick slower; Phosani's two slower and 6 prayer a yawn). The rest burst on the thirtieth tick. | capture; Wiki |
| Surge | She leaves, two ticks later stands at one of twelve lanes' start (three each way across the arena, captured), four after that crosses it in one tick: "The Nightmare surges across the room, damaging you as she does!", up to 60 in her path (about 85 Phosani's). | capture; Wiki |

## Loot

Everyone in the dream who hurt both her shield and a totem gets a roll of her table; big bones go to whoever did the most, plain bones only with a unique (Wiki). Phosani's always drops big bones. The loot lands at (3870, 9954) in the dream.

## Not captured, so ours

- The Nightmare's restart after a kill uses Phosani's "reawaken" countdown wording; the capture has no restart of the shared fight.
- How many husks, parasites and sleepwalkers come with more players (one target per five players; one sleepwalker per player).
- Claws' exact tile pattern: about one tile in each 3x3 block, as many as captured; Phosani's are thick within two tiles of each player.
- Parasite and husk max hits for Phosani's use the normal ones.
- Spores don't spread between players, and clicking the hitpoints orb doesn't weaken a parasite yet.
- The pet's drop rate doesn't fall with team size.

## Developer commands

`::nightmare` (to the sanctuary), `::nmskip` (she wakes now), `::nmshield` (her shield fails), `::nmtotems` (the totems charge), `::nmspecial <claws|husks|flowers|curse|parasite|spores|surge>`.
