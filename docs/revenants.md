# Revenants

`server/plugins/npcs/Revenants.plugin.js`, with its parts in `server/plugins/npcs/revenants/`, covers the revenants' combat (`Combat.Revenants.js`), their shared drop table (`Drops.Revenants.js`, dropped by `Loot.Revenants.js`), the bracelet of ethereum (`Bracelet.Revenants.js`), the amulet of avarice and the Revenant maledictus. The caves (entrances, fee, exits, scroll) are in [Revenant Caves](revenant-caves.md).

**Sources:**
- **OSRS captures** (rsprox): fights with a revenant hellhound, pyrefiend and dragon, deaths in the caves, and the bracelet's charging, check and toggle;
- **the OSRS Wiki:** "Revenants", "Revenants/Strategies" (Mod Ash on healing), "Bracelet of ethereum", and the "Revenants/Drops" template (rates "provided by Jagex");
- **this cache:** each revenant's animation list, labelled with the sequence names rsprox prints.

## Combat

| | Captured | Ours |
|---|---|---|
| Style | Adjacent hellhound and pyrefiend: melee and Magic; Ranged (projectile 206) at a distant player | Adjacent: melee, or Magic against Protect from Melee. At range: Magic, or Ranged against Protect from Magic (Wiki: Magic by default, reacting to protection prayers) |
| Magic | Projectile 1415 (delay 51, heights 172 → 124), area sound 162; impact graphic 1454 (delay 56, height 124) with sound 163, or splash 85 with sound 227 | The same; also hits up to 9 other players on the target's tile (Wiki) |
| Ranged | Projectile 206 (heights 80 → 124, progress 32, from cycle 35) | The same |
| Heal | Graphic 1221, reset animation, sound 3887 | +20 HP instead of attacking when below half HP with the heal ready; 15-tick cooldown; 8–25 heals per spawn (Mod Ash) |
| Animations | Hellhound 6579 / 6578 / 6558 (death sound 3718); pyrefiend 1582, cast 7820, 1581 / 1580 (death sound 697); dragon 80 for Magic | The others from their cache lists: imp 169/170/172, goblin 6184/6183/6182, hobgoblin 164/165/167, cyclops 4652/4651/4653, demon 64 (cast 69)/65/67, ork 4320 (ranged 6972, magic 6982)/4322/4321, dark beast 2731/2732/2733, knight 390 (ranged 6600, magic 1978)/388/836 |

- **Freeze (unverified, Near-Reality's numbers):** the Wiki says the Magic attack can freeze, but no capture shows one. Each accurate Magic hit has a 1-in-9 chance of a 7-tick freeze with Ice Barrage's impact graphic. The player then can't be frozen by a revenant for 20 seconds.
- **Attack sounds:** only the captured ones play (hellhound 3717, pyrefiend 696).
- **Ranged animation:** a revenant without a ranged animation in its cache list uses its attack animation for Ranged; no capture shows its own.
- **Hit delays:** melee lands on the attack tick; Magic and Ranged use the player formulas for their distance (Magic `1 + ⌊(1 + d) / 3⌋`, Ranged `1 + ⌊(3 + d) / 6⌋`).

## Bracelet of ethereum
- **Charging:** use revenant ether on it, up to 16,000. Charging and "Check" send "The bracelet has 100 (<col=007f00>0.6%</col>) charges, it will not absorb ether from defeated revenants." (captured).
- **Toggle-absorption:** "Your bracelet will now automatically absorb ether from defeated revenants." / "…will no longer…" (captured). It's saved per player. With it on, a defeated revenant's ether goes into the worn bracelet; otherwise it drops.
- **While worn charged:**
  - each revenant attack keeps 25% of its damage and costs a charge (Wiki: −75%; the rounding down is ours);
  - revenants don't start fights with the wearer (tolerant), but fight back.
- **Uncharge** returns the ether. **Dismantle** (uncharged) gives 250 ether (Wiki).
- **Death:** the bracelet is never kept. A charged one drops uncharged with its ether beside it (Wiki), for the killer if there is one.
- **Our wording:** "Your bracelet of ethereum has run out of charges.", the uncharge and dismantle messages, the full-bracelet message, and "it will absorb" in the check message.

## Drops
- **The formula:** with `A = ⌊2200 / ⌊√combat⌋⌋` and `B = 15 + ⌊(combat + 60)² / 200⌋`, a roll of 0 to A−1 gives:
  - **0:** the ancient artefact table (40 weights, or 22 when skulled, which removes the dragon med helm and cuts the emblem);
  - **below min(A, B):** the main table (198 weights);
  - **otherwise:** coins (1 to `1 + 25⌊√combat⌋`).
- **Separate rolls:**
  - **unique table:** `1/(A × 26.667)`; skulled `/0.55`; on a Slayer task `×5` (via `slayer:on-task`). Avarice 2/5, each weapon 1/5.
  - **blighted secondary:** `100/(250 − combat)`;
  - **looting bag**, and the imp, goblin and hobgoblin champion scrolls (1/5000).
- **Ether:** always, 2 to `(⌊√combat⌋ + 1) × 2`, in even amounts.
- **Placement:** drops land under the revenant for the killer. An amulet of avarice notes everything that can be noted.
- **Not included:**
  - the Wilderness Slayer tertiaries (keys, totems);
  - the Ironman "most damage" rule.

## Revenant maledictus

`Maledictus.Revenants.js`, from a captured fight (spawn to loot) and the Wiki.

**Spawning:**
- Each revenant killed in the caves adds its combat level to a world total. The boss spawns when a roll out of the "flat spawn rate" lands under that total (Wiki). The rate isn't published, so **10,000 is ours** (Near-Reality uses the same).
- After a spawn the total resets, and none appears for 45 minutes (Wiki). It despawns after 10 minutes if still alive.
- **Where:** one of the Wiki's 11 chambers. The tiles are Near-Reality's, checked walkable; the captured spawn (3213, 10098) is 4 tiles from the southern ork tile.
- **Announcement:** players in the caves get "<col=ef1020>A superior revenant has been awoken in the {north/middle/south} of the caves.." (captured). Within 64 tiles a hint arrow points at it, at its tile from afar and at the boss once in view (captured, refreshed every 2 ticks).
- **Testing:** `::maledictus` (developer) spawns it at your tile.

**Combat:**
- **Multi-combat:** it's multi-combat inside the singles caves (Wiki). The core now lets an NPC be marked multi-combat (`NPC.setMultiCombat`, `CombatFactory.multiCombatBetween`). Attack speed is 5 (captured), and it attacks every player within 15 tiles.

| Attack | Captured | Ours |
|---|---|---|
| Standard (Ranged) | Animation 9282, area sound 488, projectile 2033 (cycles 30 → 90, heights 400 → 50, angle 10, progress 32) at every player, graphic 474 (delay 90, height 16); the hit 3 ticks later | The same; max hit 30 (monster data) |
| Ice | Animation 9278, area sound 487; graphic 382 on each player's tile with sound 177; 3 ticks later "You have been frozen in place by the Revenant Maledictus' attack!", graphic 2035 and sound 168 | The same, for players still on their tile, with a Magic hit. **The freeze lasting 10 ticks is ours.** |
| Air surge | Animation 9277 (delay 30), area sound 483 (delay 58), projectile 1456 to one player's tile (cycles 58 → 150); 5 ticks later graphic 134 at the centre, 2034 on the 4 diagonals (delay 15) and 12 edge tiles (delay 30), sound 223 at 0/15/30 | The same. Damage up to 25 (Wiki), **25/17/9 by distance from the centre is ours**, typeless |
| Blood | Not captured | Animation 9279 (the cache's `npc_revenant_superior_attack_heal`), graphic 382 on each tile (**ours**, as for Ice); 3 ticks later a Magic hit on players still there, healing it by half (Wiki) |

- **Rotation:** the capture shows Ice, 3 standard, surge, 2 standard, Ice, 3 standard, surge. Ours: 2–3 standard attacks between specials, never the same special twice running (Wiki: it "cycles through" them).

**Loot** (Wiki; the announcements are captured):
- **Top damage dealer:** an Ancient emblem or totem (**50/50 is ours**), plus two rolls on the revenant dragon's table (without its ether).
- **Everyone else who hurt it:** a Blighted super restore(4) and 2 of one blighted food, under them.
- **Announcements:** every participant sees each drop: "<col=005f00>{name} received a drop: {2 x }{item}</col> <col=106f10>(Revenant maledictus)</col>".

**Amulet of avarice and Forinthry surge** (`Avarice.Revenants.js`, Wiki):
- **Amulet:** +20% accuracy and damage against revenants in the caves, and the wearer stays skulled.
- **Forinthry surge:** the top damage dealer, if wearing the amulet, gets 15% more for 30 minutes. Applied one after the other (**ours**; the Wiki doesn't say how they combine).
- **Our wording:** "You are empowered by the Forinthry surge."
- **Missing:** the surge's own skull icon.

## Spawns
- **Revenants:** the 30 spawn tiles from each revenant's Wiki location map, replacing the 15 the server had. Per type: 4 imps, demons, pyrefiends and orks; 2 of each other type. The Revenants/Strategies counts per area add up to the same 30. Every revenant seen in the captures was within 8 tiles of one of these tiles.
- **Ghosts:** five uninteractable ghosts (NPC 10474, no name or options), at the middle of where each was seen wandering in the captures. Their wander radius matches the observed spread (3–12 tiles). The Wiki only says "numerous ghosts", so these positions and the count are approximate.

## Follow-ups
- singles-plus combat;
- the Forinthry surge skull icon, and passing the surge on by killing a surged player;
- the revenant weapons' ether charges;
- the drop delay: OSRS shows the loot 5 ticks after the death animation, and our NPC death task uses 2.
