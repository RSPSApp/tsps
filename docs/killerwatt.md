# Killerwatt

Killerwatts (ids 469 and 470) hit much harder against a
player without insulated boots (Wiki, <https://oldschool.runescape.wiki/w/Killerwatt>).
They live on the Killerwatt plane; the way there is in [killerwatt-plane.md](killerwatt-plane.md).

| Attack | With insulated boots | Without |
| --- | --- | --- |
| Melee | max 6 | max 15 |
| Ranged (magical ranged) | max 8 | max 15 |

## Before

The monster dump carries a single max hit for the NPC (8), and the engine gives it one style
(melee), so a Killerwatt hit for up to 8 whatever the target wore: 2 more than the Wiki's melee
maximum with the boots and barely half of the 15 without them.

## Now

`server/plugins/npcs/Killerwatt.plugin.js` hooks `onCombatHitDamage`. For an accurate Killerwatt
hit on a player it re-rolls the hit between 0 and the Wiki maximum for what the player wears
(boots by item name, `Insulated boots`): 6 for melee with the boots, 15 for any hit without them.
Splashes are untouched, and protection prayers still apply afterwards.

Both maxima come from data, not the plugin: `server/data/definitions/npc-max-hits.json` is
osrsreboxed-db's export of every max hit the Wiki infobox lists, with its label (imported
unchanged, never hand-edited). `NpcDefinitionLoader` reads it, name-guarded like the status
immunities, and `NpcDefinition.getMaxHits()` returns the list (`[]` for an NPC without one;
`getMaxHit()` is still the dump's single value for every NPC). For a Killerwatt the plugin
takes the entry labelled `Melee` (6) as the insulated melee maximum and the entry whose label
contains `without insulated boots` (15) as the uninsulated one. Data from before the file
falls back to the Wiki's 6 and 15.

## Not done

- **The ranged attack.** The Wiki says Killerwatts cast a ranged attack from up to 13 tiles
  and melee when you reach them. Ours has only the melee style; the Wiki gives no animation
  or projectile for the ranged attack and no recording of Killerwatt combat was found, so it
  is left alone. The 8-with-boots ranged maximum therefore already equals the dump's.
- Other insulated-boots effects (Verzik's electric ball, rune dragon electricity) belong to
  other fights.

## Verification

`node --test tests/killerwatt.test.cjs` (after `yarn build`) covers both maxima, the
unchanged cases, the loaded `getMaxHits()` list for both cache Killerwatts, and that the
maxima follow the labelled entries. In game, fighting a Killerwatt with Attack, Strength and Defence at 1: the
old code with the boots worn produced hits of 7 and 8 (24 samples, max 8); with the plugin
the same set-up capped at 6 (19 samples), and without the boots hits of 9 to 15 appeared
(17 samples, max 15).
