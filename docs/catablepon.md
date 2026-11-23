# Catablepon

Catablepons (Stronghold of Security, Pestilence floor; npc 2474-2476) cast a weakening glare.
`server/plugins/npcs/Catablepon.plugin.js`.

## From rsprox captures

Recordings 339 (ticks 1172-1236), 1844 (8064, 8095), 75 (11422, 11434), 1000217, 1000414, 1723:

- Every recorded catablepon attack on a player is a Weaken cast: `catpon_attack_breath` (4272),
  `weaken_casting` (105), projectile `weaken_travel` (106), `weaken_impact` (107, delay 56),
  area sounds 3011 (cast) and 3010 (impact).
- A splash shows `failedspell_impact` (85) and sound 227, and drains nothing.
- Every glare hits on the cast's own tick, landed or splashed: 0-6 recorded (rec 339 ticks 1196 and
  1224 hit 5 and 4, rec 1723 tick 10068 hit 6, rec 75 tick 11422 hit 4 and tick 11430 a splash that
  hit 3).
- A landed glare also sends "You feel weakened." and the Strength update on that tick.
- Strength drops by floor(5% of the current level) + 1: 90->85, 104->98, 98->93, 106->100,
  99->94, 40->37, 37->35, 3->2. Glares stack on an already lowered level (40->37->35, 99->94->89).

## From the Wiki

- "will stop casting once 8% + 3 of your total strength level has been drained"; after that the
  catablepon attacks as before (its stab/magic attack, max hit 5/6/7).

## Ours

- The limit rounds 8% of the base level down; the Wiki gives no rounding and no recording drains
  a player that far.
- The glare's damage is rolled with the catablepon's own attack (stab accuracy, max hit 5/6/7);
  no recording shows which accuracy live uses. Protect from Magic applies to it.
- The drain ignores Protect from Magic (only the glare's damage is reduced). The Wiki strategy line
  ("you can also use the Protect from Magic prayer") is ambiguous and no recording has the prayer on
  during a glare.
- The projectile keeps the Weaken spell's timing; live sends the catablepon's with start 44 and
  end 56 cycles.
- `magic:curse-rule` (StandardCurses) is the hook that lets a caster's curse stack, set its own
  decrease and message. A player's curses keep the spell pages' rule.
