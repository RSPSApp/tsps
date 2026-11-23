# Catablepon

Catablepons (Stronghold of Security, Pestilence floor; npc 2474-2476) cast a weakening glare.
`server/plugins/npcs/Catablepon.plugin.js`.

## From rsprox captures

Recordings 339 (ticks 1172-1236), 1844 (8064, 8095), 75 (11422, 11434), 1000217, 1000414, 1723:

- Every recorded catablepon attack on a player is a Weaken cast: `catpon_attack_breath` (4272),
  `weaken_casting` (105), projectile `weaken_travel` (106), `weaken_impact` (107, delay 56),
  area sounds 3011 (cast) and 3010 (impact).
- A splash shows `failedspell_impact` (85) and sound 227, and drains nothing.
- A landed glare sends "You feel weakened.", a zero hitsplat and the Strength update on the cast's
  own tick.
- Strength drops by floor(5% of the current level) + 1: 90->85, 104->98, 98->93, 106->100,
  99->94, 40->37, 37->35, 3->2. Glares stack on an already lowered level (40->37->35, 99->94->89).

## From the Wiki

- "will stop casting once 8% + 3 of your total strength level has been drained"; after that the
  catablepon attacks as before (its stab/magic attack, max hit 5/6/7).

## Ours

- The limit rounds 8% of the base level down; the Wiki gives no rounding and no recording drains
  a player that far.
- The projectile keeps the Weaken spell's timing; live sends the catablepon's with start 44 and
  end 56 cycles.
- `magic:curse-rule` (StandardCurses) is the hook that lets a caster's curse stack, set its own
  decrease and message. A player's curses keep the spell pages' rule.
