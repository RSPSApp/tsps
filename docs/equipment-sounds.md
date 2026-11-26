# Equipment sounds

Wearing or removing an item plays a sound for that item. Live OSRS plays the **same sound both ways**: in the captures, removing an item played its wearing sound for 176 of 178 items. Before this, every item played one fixed sound (358 to wear, 376 to remove).

The sound isn't in the client cache (no item param, enum or DB table holds it), so it comes from rsprox captures.

## How an item's sound is chosen

`EquipmentSounds` (`server/src/main/typescript/elvarg/game/definition/EquipmentSounds.ts`), used by `EquipPacketListener` for both:

1. **The item's own `equipSound`** in `item-gameplay.json`: the recorded sound, for the 699 captured items.
2. **Otherwise the rules for its kind** in `server/data/definitions/equipment-sounds.json`:
   - a weapon: its weapon type's entry;
   - anything else (or a weapon type without one): its slot's entry.

   An entry is a sound, or rules tried in order: a case-insensitive name pattern, or none (matches anything).
3. **Otherwise the default:** 2238.

The slot comes from the cache (the item's `wearPos`), not from `equipmentType` in the JSON, which says "NONE" for most wearable items.

## The sounds

| Sound | Kind |
| --- | --- |
| 2238 | the default: amulets, rings, capes, robes, hats, masks, bolts, defenders, wands and sceptres |
| 2239 | platebodies, chestplates, chainbodies |
| 2241 | d'hide and leather bodies, chaps, vambraces; "feet" and slippers |
| 2242 | platelegs, plateskirts, tassets, legguards |
| 2240 | helms ("full helm", "med helm", faceguards) |
| 2237 | boots (cloth and leather boots: 2238) |
| 2236 | gloves and gauntlets (cloth and leather gloves: 2238) |
| 2245 | shields (kiteshields, square shields, wards) |
| 2250 | wooden shields |
| 2234 | crystal and corrupted bodies |
| 3284 | Ava's devices and Dizana's quiver |
| 2247 | staves, spears, halberds, scythes, partisans, the blowpipe |
| 2248 | swords, scimitars, daggers, two-handed swords (the "-light" swords and Osmumten's fang: 2238) |
| 2244 | bows, crossbows, darts, knives, javelins, arrows (crystal bows and the sunlight crossbow: 2238) |
| 2229 | woodcutting axes |
| 2232 | battleaxes, pickaxes, greataxes, thrownaxes |
| 2233 | warhammers, mauls, clubs, the bludgeon (blunt novelty items: 2238) |
| 2246 | maces |
| 2249 | the whip |

The rules alone give the recorded sound for 639 of the 699 captured items (91%). The rest are kept as their own `equipSound`; most are single quirks, like Dharok's platelegs (2243) or the elemental shield (1539).

## How the recordings were taken

From the [rsprox.net capture database](https://rsprox.net/database). For every inventory click:
- **Wearing:** exactly one item went into worn equipment on ticks 0–1, with exactly one synth sound on that same tick. Gear switches put several items on at once and are left out.
- **Removing:** the same, with one item taken off.
- **Counting:** per recording, so one long session can't dominate.

All world types count, since an item's sound doesn't change with the world type. An item gets the sound most of its recordings show: one sound, or a most common one seen in at least two recordings. Ties are left to the rules (one item: the Wintertodt torch).

## Banking worn items

**Deposit worn items** (the bank's `bankmain:depositworn` and the deposit box's `bank_depositbox:deposit_worn`)
plays each banked item's own sound from these rules, one per item, in equipment slot order: head, cape, neck,
weapon, body, shield, legs, hands, feet, ring, ammo (rsprox captures local 1002085 tick 20276, local 1002011
tick 19297; 1,076 attempts in 412 recordings). An item a full bank refuses stays worn and plays nothing.
**Deposit inventory** plays no sound at all (8,056 attempts of `bankmain:depositinv` in 572 recordings, 639 of
`bank_depositbox:deposit_inv`).
