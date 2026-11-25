# NPC flat armour

`server/plugins/combat/FlatArmour.plugin.js` applies the flat armour of every monster on the
Wiki's [Flat armour](https://oldschool.runescape.wiki/w/Flat_armour) list ("List of NPCs with
flat armour") from `server/plugins/combat/data/npc-flat-armour.json`. There is one row per Wiki monster
page and value, keyed by NPC gameval.

## Rules (Wiki: Flat armour)

- Only **successful melee and ranged** hits a player deals are changed. The value is subtracted
  from each landed hitsplat; a negative value adds to it. Each splat of a multi-hit weapon is
  changed separately. Misses stay 0.
- A positive value never takes a hit below 0. The Giant rockslug "will not take damage from
  attacks that deal that much or lower damage" (Wiki: Giant rockslug).
- Player magic (spells, powered staves, the Voidwaker special) ignores flat armour. So do thralls,
  poison and venom, burns and recoil. Hits from NPCs (thralls included) are never changed, and
  status damage and directly queued poison, burns and recoil skip the rolled-splat path.

## Ordering

FlatArmour listens to the generic `combat:hit-finalize` event. `PendingHit` emits it once for
each selected hitsplat, after weapon damage effects and size bonuses but before the first HP cap,
shared producer budget and swing-time XP. Its payload is `{ attacker, target, hit, damage }`;
`damage` is the mutable `HitDamage`, because the constructor is still building `hit.getHits()`.
First-successful claw-style branches pass their distributed splats through the same boundary.

Ordinary `onNpcHitModify` hooks still run at impact. Content that reads or spends the damage sees
the adjusted hit: the Moons' fight health, Dusk's phase floor and Nex's damage credit. Flat armour
is not applied again at impact, so a five-damage hit grants XP for five and lands for five.

The normal [Sulphur Nagua](https://oldschool.runescape.wiki/w/Sulphur_Nagua) (13033) gets its Wiki
5% combat XP bonus when added to the world through `npc:added` and the existing NPC multiplier API.
A landed roll of 1 becomes 5 damage and 21 melee-style XP at a 1x world rate. The quest variants
keep their 0% bonus. The [Combat Wiki](https://oldschool.runescape.wiki/w/Combat) supplies the base
4 melee/ranged XP per damage; the existing XP system retains tenths for Hitpoints XP.

Cannonballs and Karil's derived follow-up supply their fixed roll in `PendingHit` configuration,
rather than replacing an already finalized result. With `damage`, `rollAccuracy: false` and
`handleAfterHitEffects: false`, this value is authoritative: it retains its explicit size bonus,
flat armour and HP cap, but does not roll the worn weapon or its procs again. Ordinary configured
hits still run their weapon hooks. Cannonballs keep their own 2 Ranged XP per landed damage and no
Hitpoints XP. [Karil's amulet effect](https://oldschool.runescape.wiki/w/Amulet_of_the_Damned) keeps
half the first hit's damage as its follow-up roll and grants no secondary XP. Its exact combination
with flat armour is not recorded here; the existing half-primary rule is retained, with flat armour
applied independently to each landed splat.

## Verification limits

The in-process tests supply actors and scripted damage/accuracy rolls, then use the real cache,
`PendingHit`, queue, XP and impact handlers. They cover capped overkill, both armour signs, misses,
multi-splats and shared budgets, first-successful branches, magic/Voidwaker classification, NPC
attackers, status/recoil paths, derived producers and the Moons' impact consumption. No game client,
rendering, live retail capture or audio verification was run for this correction.

## Data

The ids come from each monster's infobox (`flatarmour`/`id` per version), turned into rev 242
gamevals. Where the Wiki gives only the visual multi-NPC, the combat NPC behind it is added as
well: `pmoon_boss_blood_moon` / `pmoon_boss_blue_moon` (13016/13017, shown as 13011/13013) and
`pmoon_quest_nagua` (12878, shown as 12879).

Left out:

- **Eclipse Moon**: 6, or 4 during its Clones special. It needs the fight's clone state
  (`moonsofperil/EclipseMoon.MoonsOfPeril.js`).
- **The Smorks** and Bork: Bork's room applies them (`minigames/tfa/Bork.FracturedArchive.js`).
- **Veiled kraken** (15): sea combat.
- **Shade (Ancient asylum)** 16917: not in the rev 242 cache.
- Amoxliatl (Echo): a Leagues override.

Monster Examine (Lunar) does not yet show the value.
