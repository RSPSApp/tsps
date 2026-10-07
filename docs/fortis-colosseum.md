# Fortis Colosseum

The Fortis Colosseum, built from the OSRS Wiki, a live rsprox capture (the lobby to the start of wave 1) and the cache. Offline_Scape's unfinished port served as a reference, mainly for wave composition and spawn points (which it credits to the LlemonDuck *fortis-colosseum* RuneLite plugin and Supalosa's line-of-sight tool) and, later, Sol Heredit. It is one plugin, `server/plugins/minigames/Colosseum.plugin.js`, which delegates to one unit per area in `server/plugins/minigames/colosseum/`.

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | Lobby, Minimus, entry, the arena, intermission and modifier choice, waves and reinforcements, leaving and death | Done |
| 2 | The seven enemy types' own attacks | Done |
| 3 | Modifier effects | Done |
| 4 | Sol Heredit | Done (no boss health HUD yet) |
| 5 | Rewards, the chest, Glory and the pet | Done |
| 6 | The scoreboard, and the Colosseum's items (Dizana's quiver, echo boots, Tonalztics of Ralos, the quiver exchange with Minimus) | To do |

## Layout

| File | What it owns |
| --- | --- |
| `ColosseumShared.js` | Ids, tiles, Glory titles and helpers such as the fade. |
| `ColosseumWaves.js` | What each wave sends in and where it spawns. |
| `ColosseumModifiers.js` | The modifiers from the cache, their tiers, and what Minimus offers. |
| `ColosseumRun.js` | One player's run: the arena, Minimus, the intermission, waves, leaving. |
| `Enemies.*` | The seven enemy types' attacks, their spawn delays, the warband's movement and the Minotaur's healing. |
| `ModifierEffects.*` | Modifiers that change blows or the player: Blasphemy, Doom, Frailty, Myopia, Relentless, Mantimayhem's venom. |
| `ColosseumHazards.js` | Modifiers that put something in the arena: Bees!, Solarflare, Totemic, Volatility, Reentry's molten sand. |
| `Lobby.*` | The way down and back up, Minimus's introduction, the bank chest and the tunnel. |
| `Arena.*` | Minimus's Start-wave and Leave, the intermission buttons, death and login. |
| `SolHeredit.*` | Wave 12: Sol Heredit's greeting, landing, attacks, phases, sand and light crystals. |
| `SolPatterns.js` | The tiles Sol's attacks cover, the barricade, and where his sand falls. |
| `ColosseumLoot.js` | The rewards chest's tables (from the Wiki) and the rolls. |
| `Rewards.*` | The run's loot and Glory, and the rewards chest. |
| `Commands.*` | Developer commands. |

## The lobby

| What | Where | Notes (capture unless marked) |
| --- | --- | --- |
| Colosseum entrance (50749, Enter) | (1796, 3106), in Civitas illa Fortis | Fade out, then two ticks later the lobby at (1799, 9506). |
| Stairs (50750, Exit) | (1796, 9506) | Back up to the city. |
| Minimus (12807) | (1805, 9508) | His transcript is in `npc-dialogues.json`. His first talk is his introduction and sets varbit 9807. |
| Gloria (12809) | Beside Minimus | Talk-to only (her transcript). |
| Bank chest (50748) | (1805, 9501) | Below 2,000 Glory (Brawler, Wiki): "Oi, get yer hands off that! It's reserved for survivors of the Colosseum." then "You do not have enough Glory to use that.". |
| Entrance (50751, the tunnel) | (1810, 9506) | Before the introduction: "Oi! Where d'you think you're going? …". |

The lobby's NPCs are in `npc-spawns.json` at their captured places: Minimus, Gloria, three wandering gladiators and two doing push-ups. The sparring gladiators that come and go in the capture are left out.

**Entering through the tunnel:**
1. A warning box: "You are about to enter the Fortis Colosseum. Within, you will face multiple waves of deadly foes. Dying at any point is not considered a safe death. Apart from between waves, there is no exit within the Colosseum, but teleporting out is allowed."
2. "Are you sure you wish to enter the Fortis Colosseum?" with "Yes, I understand the risks." / "Yes, and don't ask again." / "No.". "Don't ask again" skips both from then on.

Minimus's "[rank]" is the Glory title (Wiki):

| Glory | Title |
| --- | --- |
| 0 | Rookie |
| 2,000 | Brawler |
| 5,000 | Challenger |
| 8,000 | Gladiator |
| 12,000 | Hero |
| 16,000 | Champion |
| 20,000 | Grand Champion |

## The arena

Live OSRS copies the arena's map square into an instance. Here the arena is a private area over the real tiles, (1806-1842, 3088-3128) on plane 0, as the Inferno does: the arena floor is walled in and no city tile reaches it.

**On arrival** (capture):
- You land at (1824, 3094), then from the next tick walk north to (1824, 3104), a tile short of Minimus.
- The seated Sol Heredit (12827) is at (1823, 3123) on a blocking loc (50703).
- Minimus (12808, "Start-wave" and "Leave") appears at (1824, 3106) with anim 10862. He says "A Rookie approaches!", then "Let me know when you want to begin." three ticks later.
- The arena is multi-way.

**The intermission screen** is interface 865 on the main modal:
- Script 4931 is run with the waves cleared, the three modifier keys offered, three reward values and a final int.
  - The reward values (`0, 30560, 0` before wave 1) are the value of the loot so far, of the next wave's, and of the last wave's. rsprox labels them longs, but this cache's script 4931 takes eight ints (its footer has no long arguments), so they are sent as ints.
  - Before the script, the three reward inventories are sent in full: 843 (so far), 844 (the next wave's), 845 (the last wave's).
- Components 8, 39, 34 and 37 get op1 (`if_setevents`).
- Buttons 15-17 pick a modifier (varbit 9788 = 1-3), and 41 confirms.
- Confirming sets varp 4135 to the modifier's Glory per wave, sets its tier varbit, and closes the screen. The wave starts five ticks later.

**A wave:**
- **Start** (capture):
  - Highest wave (varbit 11410), the start time (varp 4133), and "Wave: 1" in red.
  - The trio and the shaman play anim 10861 as they appear.
  - Damage taken in the wave goes to varp 4134.
- **Composition** (LlemonDuck's plugin, matching the Wiki):
  - The Fremennik trio every wave; the serpent shaman on waves 1-6.
  - Javelin Colossi: 1 on wave 2, 2 on wave 3, then alternating 2/1 from wave 5.
  - Manticores: 1 on waves 4-8, 2 from wave 9.
  - The Shockwave Colossus on waves 7, 8 and 11.
  - Quartet adds an archer; Dynamic Duo doubles the Shockwave Colossus.
- **Spawn points:**
  - The trio forms around a random tile in (1821-1827, 3105-3111): berserker north, archer west, seer east.
  - The rest take distinct points among 12 fixed ones, none within 4 tiles of the player.
- **Reinforcements:** a wave not cleared inside 40 seconds (67 ticks) gets them through the gate on the player's half (north y 3122, south y 3091):
  - the Jaguar warrior on waves 1-6;
  - a shaman on waves 4-6 and 10-11;
  - the Minotaur on waves 7-11 (its route-finding version with Red Flag);
  - none on wave 12, Sol Heredit's.

  A wave cleared before then ends without them (Wiki).
- **Clearing:** "Wave N completed! Duration: m:ss.ss" (Offline_Scape), and Minimus reappears a tile north of the player.

**Leaving and dying:**
- Minimus's Leave before wave 1: "Are you sure you wish to leave?" (Yes./No.).
- Leave after wave 1: his forfeit warning and "Are you sure you wish to leave early?" (both from the transcript). Yes brings out the rewards chest (see Rewards).
- Leaving through Minimus restores every stat to its level (Wiki).
- Teleporting or logging out ends the run and loses its loot and Glory.
- Dying (capture) shows "Oh dear, you are dead!" and puts you in the lobby at (1804, 9508). The loot is lost; the run's Glory is kept (Wiki). The Wiki's grave is in the lobby; this server has no graves, so what would drop lands there.

## Enemies

**Numbers (Wiki):**

| Enemy | Max hit | Range | Attack speed | Notes |
| --- | --- | --- | --- | --- |
| Berserker | 29 | 1 | 6 | Melee |
| Seer | 12 | 1 | 6 | Magic, only from melee range |
| Archer | 14 | 1 | 6 | Ranged, only from melee range |
| Serpent shaman | 27 | 10 | 5 | Magic |
| Jaguar warrior | 47 | 1 | 5 | Three hits, each rolled on its own |
| Javelin Colossus | 48 | 15 | 5 | Ranged, plus the artillery javelin |
| Manticore | 31 / 36 / 31 | 15 | 10 | Magic / ranged / melee orbs |
| Shockwave Colossus | 56 | 15 | 5 | Magic |
| Minotaur | 74 | 1 | 5 | Melee; heals |

**Spawn delay:** every enemy waits 3 ticks after appearing. The trio then take their first swings a tick apart: berserker, seer, archer (Wiki; Offline_Scape's captures).

**The Fremennik warband** (Wiki; Offline_Scape's captures) doesn't chase the way other NPCs do:
- Each heads for its own tile beside the player (berserker north, seer east, archer west, Quartet's extra one south) and routes around the pillars.
- If a pillar takes that tile, one heads for the nearest open side tile no other warbander claims, or holds still. Routing to the blocked tile would fall back to the nearest reachable one, which can be the player's own tile, where it can't attack (Offline_Scape describes the same).
- They run, and walk through other NPCs.
- A swing that comes while one is still moving is skipped, and the next waits a full attack cycle.
- The style each is weak to (magic on the berserker, ranged on the seer, melee on the archer) always hits it for the player's maximum.

**Minimus** answers Start-wave and Leave from anywhere in the arena: the player doesn't walk up to him (live behaviour).

**Javelin Colossus artillery:** every fifth attack is the javelin thrown into the air (anim 10893, graphic 2676). It lands 3 ticks later on the tile the player stood on (shadow 1446, landing 2674) for up to 40 typeless damage.
- Offline_Scape's captures give the 3 ticks; the Wiki says 6.
- The Wiki gives the 40.

**Manticore volley:**
1. It charges (anim 10868).
2. From the sixth tick it throws the orbs a tick apart (anim 10869): magic and ranged in either order, then melee.
3. Each orb rolls its damage, with the player's protection prayer at that moment, as it is thrown (Wiki).

Projectiles and impacts:

| Orb | Projectile | Impact |
| --- | --- | --- |
| Magic | 2681 | 2682 |
| Ranged | 2683 | 2684 |
| Melee | 2685 | 2686 |

While it charges, the orbs show on its body in throwing order, one a tick, in spotanim slots 1-3 (the orb projectile graphics above). Each slot is cleared as its orb is thrown. They float above it at different heights, lowest to highest green (ranged, 290), blue (magic, 380), red (melee, 470); the heights are tuned by eye. An orb's spin (seqs 10327-10329) plays for 60 client cycles, so a held orb is sent again every tick until it is thrown (every 2 ticks left a gap where it flashed off). The RuneLite Fortis Colosseum plugin reads the order the same way, from the Manticore's spotanims.

**Minotaur:**
- Its damage lands a tick after its swing (Wiki).
- While not in melee range of the player, every 5 ticks it heals each damaged enemy within 6 tiles to full. The Wiki says it heals continuously and gives no rate; the healing has no animation here.

**Animations and graphics:**
- The trio and the shaman are from the capture. Shaman: anim 10859, cast 1458, projectile 1459, impact 1460. Seer: 10853 with fire blast 130/131. Archer: 10850 with arrow 9. Berserker: 10856.
- The colossi are from Offline_Scape. Javelin: 10892 with projectile 2673. Shockwave: 10903 with projectile 2520.
- The Minotaur's attack, 10843, also comes from Offline_Scape.
- The jaguar's attack, 10847, is RuneLite's `NPC_JAGUAR_RANGER_CLAWS_ATTACK`.
- Every enemy's block and death animations (and Sol's) are in `npc-combat-defs.json`, from RuneLite's gameval names. Sol, the shaman, both colossi and the Manticore have no block animation (`-1`); without an entry they fell back to the humanoid one.

**Not done yet:**
- Two Manticores copying each other's orb order.
- Line-of-sight rules, including the Minotaur's healing being blocked by the pillars.

## Modifiers

Enum 5312 lists the 14 modifiers by the key the intermission script takes. Each is a struct:

| Param | What |
| --- | --- |
| 1896 | Name |
| 1897-1899 | Tier texts |
| 1901 | Has tiers |
| 1903 | Glory per wave |
| 1914 | Icon |

Script 4980 reads each tiered modifier's tier from its own varbit:

| Modifier | Tier varbit |
| --- | --- |
| Blasphemy | 9790 |
| Bees! | 9791 |
| Reentry | 9792 |
| Myopia | 9795 |
| Frailty | 9796 |
| Solarflare | 9797 |
| Relentless | 9798 |
| Volatility | 9799 |
| Doom | 10681 |
| Mantimayhem | 4588 |

The capture's first offer was keys 4, 5 and 12 (Blasphemy, Relentless, Frailty). That matches the Wiki's fixed wave-1 offer, and picking Blasphemy set 9790 to 1.

**Offer rules (Wiki):**
- Red Flag and Dynamic Duo are offered from wave 7 (Dynamic Duo not after wave 11).
- A maxed or untiered-and-taken modifier isn't offered again.
- Upgrades of picked modifiers are favoured. The Wiki gives no figure; here an upgrade is twice as likely as a new modifier.

## Sol Heredit (wave 12)

Sources:
- The Wiki's Sol Heredit page and the Strategies page give the mechanics, timings and damage.
- His lines come from his transcript in `npc-dialogues.json`.
- RuneLite's gameval tables give the animations and graphics.
- Offline_Scape gave what the Wiki doesn't (marked **RSPS** below).

**Start:**
1. Confirming the twelfth intermission plays his greeting for the attempt: first, second, third, or later (persisted per player). The greeting is skipped once he has been beaten.
2. He jumps (anim 10876), with "Sol Heredit jumps down from his seat...", and the screen fades.
3. The seated Sol and his seat's blocker go.
4. The gladiators' barricade goes up: locs 50753-50758 along the edges between the four pillars, (1817, 3099)-(1832, 3114) (**RSPS**).
5. The player is put at (1825, 3103) (**RSPS**).
6. Sol (12821, 1,500 HP, size 5) lands at (1823, 3108) (**RSPS**) with anim 10877 and graphic 2666, and says "Let's start by testing your footwork."

**Attacks** (Wiki unless marked):

| Attack | What | Speed |
| --- | --- | --- |
| Spear 1 / Spear 2 | 5x5 under him, the row in front (cardinal), and two / three 4-tile lines towards the player. At a diagonal, Spear 2 covers 7x7 under him (**RSPS**). | 7 (6 from 75%) |
| Shield 1 / Shield 2 | Everything within 7 tiles except the ring at 9x9 / 11x11. | 6 (5 from 75%) |
| Triple (below 90%) | Hits at 3, 6, 9 ticks (9 becomes 10 from 50%) for 15/25/35 (15/30/45 from 50%), blocked by Protect from Melee on as it lands. Protect from Melee already on in the 2 ticks before a hit is switched off ("Sol Heredit doesn't take kindly to your eager prayer.") and the hit lands. | 12 (11 from 75%, **RSPS**) |
| Grapple (below 75%) | He calls body, back, hands, legs or feet. Clicking the worn item in that slot within 4 ticks defends it; the item stays on. On the last tick it is a perfect parry: the player's next attack within 5 ticks is a max hit. A wrong slot: "You defended the wrong body part!". Undefended: 20-45 damage (**RSPS** minimum, Wiki maximum) and the item torn off into the inventory. | 7 (**RSPS**) |

More on the attacks:
- AOE damage is up to 44 typeless, from his tile at the swing, landing 2 ticks later (**RSPS** timing). He can't move for 4 ticks from an AOE.
- A second Spear or Shield in a row uses pattern 2. A different attack resets the pattern, and so does a special. He opens every phase with a Spear.
- The pool is two Spears and two Shields, plus the unlocked specials. After a special, two ordinary attacks must pass before the next (**RSPS**).

**Phases** at 1350, 1125, 750, 375 and 150 HP (90/75/50/25/10%), each with its transcript line. Each transition:
- puts 6 beams of light (graphic 2698) in the 9x9 around the player, one on the player's tile, each leaving molten sand 2 ticks later (6-8 damage a tick, for the fight);
- adds a light crystal (NPC 12824), four at most;
- freezes him for the transition, a 7-tick attack (**RSPS**).

Enraged (150 HP): 5 pools at once, then one more every 3 ticks, and the crystals fire every 12 ticks with 2 ticks' warning.

**Light crystals** (patrols and cooldown **RSPS**):
- Each patrols one edge of the barricaded arena: north, then east, south, west.
- They fire together every 25-35 ticks.
- Firing: the charge (anim 10801, graphics 2689-2692 along the beam), then 3 ticks later the beam (anim 10802, graphics 2693-2696, end 2697).
- A player in the beam takes 60-75 damage: the Wiki's "up to 75" / "70+", with Offline_Scape's minimum.

**Modifiers in wave 12** (Wiki):
- The Solarflare orb circles a 5x5 by one corner of the barricaded arena.
- A totem heals him 75 every 7 ticks.
- Volatility makes him explode too (graphic 2724).

**His end:**
- He says one of his death lines, the kill is counted (no greeting next time), and after his death animation (10888) the run ends.
- If the player dies, he says one of his lines for that.

**Not done yet:**
- The boss health HUD.
- The enraged crystals aiming at the player.
- The camera of the live cutscene.

## Rewards and Glory

**Loot** (Wiki, "Rewards Chest (Fortis Colosseum)"):
- Each wave's loot is one roll on its table in `ColosseumLoot.js`; wave 1 is always 80 sunfire splinters.
- The roll happens before the wave, so the intermission screen shows it (capture).
- Sunfire fanatic pieces have duplicate protection: a piece the player has had fewest of comes first, counted once the wave is cleared (attribute `colosseum:fanatic-pieces`).
- Wave 12 adds Dizana's quiver (uncharged) and rolls Smol Heredit at 1/200. The pet goes through the Pets plugin's `npc-drops:roll`, which now knows Smol Heredit (follower 12857).
- Left out: the Varlamore token on wave 3 (the Wiki gives its rate as "varies").
- Values are the items' GE prices (`item-prices.json`). The capture's 80 splinters at 30,560 is 382 each.

**The chest** (Wiki; tiles **RSPS**):
- Forfeiting between waves, or beating Sol Heredit (once his death animation has played and his hazards have gone), brings the Rewards Chest (loc 50741, appear anim 10825) out at (1829, 3105), with Minimus at (1830, 3103) to leave by.
- Search opens interface 246: the items (inventory 843) in component 11 with Take, Bank-all (5), Take-all (7), Discard-all (9), and "Total Value: N" (3).
- Loot left in the chest is lost on leaving. Dying, teleporting or logging out loses all of it (the capture's death sent an empty preview and "Total Value: 0").

**Glory** per cleared wave (Wiki, "Glory"):

| Part | Points |
| --- | --- |
| Completion | 100 x wave |
| No damage | 100 x wave, unless an enemy hurt the player that wave (Solarflare, sand, the sky javelin, explosions and swarms don't count) |
| Modifiers | Every active modifier's Glory (param 1903) x its tier |
| Time | 500 x wave less wave a tick, never below 0, rounded down to an even number |

- The run's total is in varp 4132.
- The best run is the player's Glory (`colosseum:glory`, which sets the title and the bank chest).
- A run counts when the player leaves through Minimus or dies; a teleport or logout doesn't.
- Counting swarms and explosions as environmental is an estimate.

## Modifier effects

The Wiki's modifier table gives the effects. RuneLite's gameval tables name the NPCs, animations and graphics. The Wiki gives no damage figures for Solarflare or the Volatility explosions, so those are estimates (marked below).

| Modifier | What it does here |
| --- | --- |
| Blasphemy | Prayer drained by 20/40/60% of each hit taken. |
| Doom | A stack per hit taken, shown in the Doom hitsplat (type 73, RuneLite) with the count. 15/10/5 stacks kill; stacks clear when a wave is completed. |
| Frailty | Hitpoints level lowered by 10/20/40% for the run, and healing above it is lost. The level comes back when the run ends (it is never saved). |
| Myopia | Attack range 2/4/6 tiles shorter, never below 1. Manual casts are unaffected. |
| Relentless | Max hits +1/+3/+6. Accuracy is rolled as if 33/66% of the Defence level were gone; at III every blow hits. |
| Mantimayhem | I: two of each orb, each rolled on its own. II: an orb not prayed against envenoms, and the venom is cured when a wave ends. III: the orbs come in any order. |
| Bees! | 1-3 swarms (NPC 12823, 2x2, 1 HP) step towards the player every 12 ticks. Under one: up to 10 poison damage a tick (halved by antipoison) and poison. A killed swarm returns 50 ticks later. |
| Solarflare | An orb (NPC 12826) walks the ring around one pillar: every 2 ticks with 7 at each corner (I), every 2 ticks without stopping (II), or every tick with 2 at each corner (III, which also turns prayers off). |
| Totemic | An enemy at half health or below gets a healing totem (NPC 12825) to its south-west. The totem starts healing 5 ticks later and heals 30% at a time until the enemy is full (anim 10828, projectile 2687, impact 2688). A destroyed totem returns 200 ticks later, and a totem goes with its enemy. |
| Volatility | A dead enemy explodes 2 ticks later, one (I) or two (II, III) tiles past its size. III leaves molten sand on the centre tile. Explosion graphics 2713 (human), 2721 (Manticore, which plays its exploding death 10867), 2722 (colossi), 2723 (Minotaur). |
| Reentry | Where a sky javelin lands: molten sand for the wave (I); from II the sand is permanent and the tile south-west is added, and III adds the tile west of that one. A blocked tile moves to a random free neighbour. |
| Quartet | A random warbander joins the trio, to the south (Wiki). |
| Dynamic Duo, Red Flag | Wave composition (see above). |

**Molten sand** is loc 50746, which doesn't block. Standing on it deals up to 15 damage every other tick, and none between waves (the Molten Sand page).

All the damage above goes through the run, so it adds to the wave's damage taken (varp 4134), Blasphemy and Doom. Swarms, the orb and totems never count towards clearing a wave, and they go when it ends.

**Estimates** (the Wiki gives no figure):

| What | Value here |
| --- | --- |
| Solarflare damage | Up to 5/10/15 when the orb reaches the player. |
| Volatility explosion damage | Up to 15. |
| Totem heal rate | Every 5 ticks. |
| Which pillar the orb circles | A random one each wave. |
| Where swarms appear | A random spawn point at least 4 tiles from the player. |

The Bee Swarm page says 15-20 damage a tick where the modifier table says up to 10; the modifier table is followed.

**Core additions** (generic, used by these modifiers):
- `api.onCombatAttackDistance`: plugins can adjust an attacker's reach (Myopia).
- `SkillManager.setMaxLevelCap`: a temporary, unsaved cap on a base level (Frailty).
- `api.core.AccuracyFormulasDpsCalc` (Relentless).
- `Mobile.showHitsplat` and per-hit splat types (the Doom hitsplat). These are the same change as the Wintertodt branch's.
- `forceMaxHit` on the hit-roll event (the warband's weakness, Sol's perfect parry).
- `NPC.WALK_THROUGH_ENTITIES_FLAG` (the warband, the orb, swarms).
- `Mobile.performGraphicInSlot(slot, graphic)`: several spotanims on one actor at once, each in its own slot (the Manticore's orbs). The update block already carried a slot list; the server now sends every slot. The client already decoded and drew them.

## Developer commands

| Command | What it does |
| --- | --- |
| `::colosseum` | To the lobby. |
| `::colokill` | Kills the wave under way. |
| `::cologlory <glory>` | Sets your best Glory (title, bank chest). |
| `::colowave <1-12>` | Between waves: makes the next wave the given one (12 is Sol Heredit), with its loot rolled. |
| `::colomod <modifier> <0-3>` | Between waves: sets a modifier's tier (`blasphemy`, `doom`, `solarflare`, `red-flag`, ...). |

The Fortis Colosseum is also in `::teleports` under Minigames.
