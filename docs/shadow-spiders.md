# Shadow spiders

`server/plugins/npcs/ShadowSpiders.plugin.js`, tests in `server/tests/shadow-spiders.test.cjs`.

Shadow spiders (npc 3016: Waterfall Dungeon, Deep Wilderness Dungeon, Buccaneers' Laboratory) fight
with an ordinary stab melee swing. The first swing of a fight also drains the target's Prayer.

## Wiki (Shadow spider)

- "If a player initiates combat, it will drain the player's Prayer points by half of the current
  amount, rounded up."
- "Wearing a spectral spirit shield reduces the Prayer drain by half." The drain goes through the
  shared prayer-drain modifiers, so the shield's usual halving (a coin flip at 1) applies.
- "They can never take away a player's last prayer point."
- 30 November 2022: they "no longer drain a player's prayer if they are not in combat with the
  player". Only the spider's own target is drained.

## rsprox captures

Local recordings 1001903 (rev 242; ticks 1990, 2035, 2197) and 1001457 (rev 241; ticks 1452, 1464,
1500, 2127), both in the Waterfall Dungeon, with aggressive spiders attacking the player:

- The drain lands on the tick of the spider's attack (seq 5327), together with the game message
  `The spider drains your prayer...` and synth `prayer_drain` (2672). The swing's own hitsplat
  lands normally.
- Each spider drains once per engagement. 1001903: spider 16636 swung five times over 21 ticks
  from tick 2197 and only the first drained. 1001457: spider 16617 drained at 1452, left the
  player's view at 1477, and drained again on its first swing after it came back (1500).
- Each new spider drains on its own first swing (1001457 ticks 1452 and 1464, two spiders).

An engagement ends when the spider's combat ends (it drops or loses the player, the player
leaves, it dies) or it changes target. Its next swing at that player then drains again.

## Recorded difference

Every recorded drain left `ceil(prayer / 2)`, which is a drain of half rounded **down**: 52 to 26,
26 to 13, 21 to 11, 13 to 7, 11 to 6, 7 to 4, 6 to 3. The Wiki says "rounded up", so the server
drains `ceil(prayer / 2)`, stopping at 1 point (21 to 10, 13 to 6, 7 to 3).

## Not covered

- "they will continue to drain the player's Prayer at regular intervals" in a long fight: neither
  the Wiki nor the recordings give an interval, so only the first swing of each engagement drains.
- With nothing to drain (prayer at 1 or 0, or a spectral shield rounding the drain to 0) no message
  or sound is sent. Ours: no recording shows that case.
