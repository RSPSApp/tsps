# Zogres

`server/plugins/npcs/Zogres.plugin.js` scales the hits players land on Zogres, Skogres and Slash Bash
(by NPC name). Slash Bash's own attacks are in
`server/plugins/quests/zogreflesheaters/SlashBash.ZogreFleshEaters.js` (see
[the quest's page](quests/zogre-flesh-eaters/README.md)).

## Damage taken (the Wiki)

| Attack | Damage | Source |
| --- | --- | --- |
| Anything else (melee, other spells, non-brutal arrows) | rolled hit ÷ 4, rounded down | Zogre / Skogre: "damage is reduced by 75%", Mod Ash: "Damage divided by 4. I didn't see any sign of a floor."; Slash Bash: "only hit up to 25% of their normal max hit" |
| Brutal arrows from the ammo slot | in full | Slash Bash: "Brutal arrows deal 100%"; Zogre / Skogre: "effective" |
| Crumble Undead | rolled hit ÷ 2, rounded down; at most 7 on Zogres and Skogres | Zogre / Skogre: "damage is halved, for a maximum of 7"; Slash Bash: 50%, no cap stated |

The hit is scaled after accuracy and before protection and the hitsplat (`onCombatHitDamage`).
Crumble Undead's base maximum of 15 halves to 7; the cap keeps a boosted cast (salve amulet, slayer helmet) on a
Zogre or Skogre at the page's 7.

## Not covered

- Ours: only a player's own attacks are scaled. The pages list cannons and thralls as "Not immune" and
  say nothing of their damage.
- Zogres inflicting disease (Wiki: "Poisonous: disease"); `plugins/combat/Disease.plugin.js` has the
  `disease:inflict` event, but nothing raises it for zogres yet.
