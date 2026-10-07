# Slayer Tower

`server/plugins/areas/SlayerTower.plugin.js` handles the entrance door, the basement ladder and the basement's darkness. The ivy, the broken windows and the spikey chains are agility shortcuts in `server/plugins/skills/agility/shortcuts/Morytania.js`.

**Sources:**
- **an OSRS capture** (rsprox): the entrance, both window shortcuts, the ivy, and the basement ladder down and up;
- **the OSRS Wiki:** "Agility shortcuts" and "Spikey chain (Slayer Tower medium)", for levels and XP.

## Entrance (captured)
The entrance is one double door: 2108 and 2111 in the doorway at 3428–3429, 3535, rotation 1.

**Open** (either leaf, the same tick):
- both leaves come off the doorway, and the open pair appears a tile north: 2112 (rotation 0) and 2113 (rotation 2);
- both gargoyle statues beside it, at 3426 and 3430, 3534, turn from 5116 to their open pose 5117;
- sounds 46, then 2717 twice.

**Close** (either open leaf): the leaves and statues go back, with sounds 60, then 2718 twice. It doesn't close on its own.

The generic Doors plugin used to pair only 2111 with 2112, and never touched the statues.

## Basement ladder (captured)
Ladder 30191 at 3417, 3535 (ground floor) ↔ 30192 at 3412, 9931 (plane 3).
- **Both ways:** animation 828 at the ladder, then the move a tick later.
- **Landing tiles:** going down lands at 3412, 9932, plane 3; going up lands at 3417, 3536.
- **Generic handler:** the generic ladder handler can't find this pair, since the ends are in different map regions. This plugin claims them through `ladders:climb`.

**The basement is dark:** varbit 278 (`darkness_level`) is 1, and the darkness overlay (97) shows on the atmosphere layer while you're inside. Coming up clears both.

**No light source needed:** the capture went down without one.

## Agility shortcuts
| Shortcut | Level | XP | Captured |
|---|---|---|---|
| Broken window 57679, 3443, 3532: the banshee room | 18 | 3 | one 2-tile diagonal move between 3442, 3531 and 3444, 3533, animation 839 over 94 cycles; XP the tick after |
| Ivy 57677, 3418, 3533: up | 81 | **0** | see below |
| Broken window 57678, 3419, 3533, floor 2: down | 81 | **0** | see below |
| Spikey chains 16537/16538 | 61 / 71 | 3 | not captured |

**XP for the ivy and upper window:** the Wiki lists 3, but the capture shows no XP update for either, so we give none.

**Ivy up**, one tick each:

| Tick | What happens | Sound |
|---|---|---|
| 0 | animation 828 | 2454 |
| +1 | plane 1, animation 4435 (climbing loop) | 2454 |
| +2 | plane 2 | 2454 |
| +3 | animation 2757 (ledge walk), one tile east | — |
| +4 | animation 2588 (landing), in to 3420, 3534 | 2462 |

**Window down**, from 3420, 3534 on floor 2:
1. animation 741 (jump) onto the ledge, sound 2461;
2. animation 7142 (ledge walk) west;
3. animation 740 (climbing down), then down a plane each tick with sound 2454;
4. at the foot, facing south.

**Spikey chains:** the Wiki gives 3 XP on success, or 6 XP and 2–5 damage on a failure that still climbs. It gives no failure chance, and no text for the nose-peg warning on the medium chain, so neither is in yet.
