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
  poison, burns and recoil are queued past `onNpcHitModify`.

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
