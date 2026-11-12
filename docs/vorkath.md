# Vorkath

Code: `server/plugins/bosses/vorkath/` (Combat, Specials, Shared). This page holds the capture facts
the zombified spawn relies on; the rest of the fight cites its sources in the code.

## Zombified spawn explosion

When the spawn reaches the player it explodes. As recorded (rsprox.net recordings 127, 129 and 543,
revision 227; 3280, revision 234; every explosion in them alike), on that tick:

- the red game message `<col=ff3045>The spawn violently explodes, unfreezing you as it does so.</col>`;
- the spawn plays `ds2_spawn_attack` (seq 7890);
- `map_anim watersurge_impact` (1460) on the spawn's tile, delay 22, height 30;
- synth sounds 232 and 208 (delay 22) to the player. The landing sound 232 is a `sound_area`
  (range 16) when the spawn lands; the explosion sends it as a plain synth sound.

The hit lands and the spawn is removed on the next tick. Killing the spawn first sends
`<col=229628>You become unfrozen as you kill the spawn.</col>` instead.

All the recordings are on Leagues or event worlds; nothing in them suggests the main game differs.
