# Morytania boats

Once Sins of the Father is complete, the boats at Burgh de Rott, Meiyerditch, the Icyene Graveyard
and Slepe link all four docks. Before then each dock stays with its quest (Darkness of Hallowvale's
boat to Meiyerditch, Sins of the Father's crossings).

- **Code:** `server/plugins/world/ferries/Morytania.Ferries.js` (in the Ferries plugin).
- **Data:** `server/plugins/world/data/ferries.json`: the `morytania` block (docks, menu, the
  Meiyerditch jump) and the `morytania-*` fade routes.
- **Test:** `server/tests/morytania-boats.test.cjs`.

## The docks

| Dock | Loc (base gameval) | Shows Boat when | Landing | Faces |
|---|---|---|---|---|
| Burgh de Rott | `sang_boat_water_multiloc` (12945) at 3522,3169 | varbit 2587 (Darkness of Hallowvale's boat) is 1 | 3525,3170,0 | east (1536) |
| Meiyerditch | `sang_boat_edge_jump` (17961) at 3605,3161,1 | always | 3605,3161,1 (on the boat) | north (1024) |
| Icyene Graveyard | `ig_boat` (39520) at 3681,3174 | varbit 7255 (Sins of the Father) 44-138 | 3684,3176,0 | north (1024) |
| Slepe | `myq5_slepe_boat` (39521) at 3663,3274 | varbit 7255 80-138 | 3663,3277,0 | west (512) |

## What live sends (rsprox captures)

From recording 231/392 (ticks 5337-8060, ten trips covering every dock) and 239/4266 (tick 786):

- **Board:** the menu "Where would you like to go?" with the other three docks, always in the
  order Burgh de Rott., Meiyerditch., Icyene Graveyard., Slepe.
- **The trip,** from the pick (tick 0):
  - tick 0: fade_overlay out, an empty message box (no text, no continue), song 147, jingle 137;
  - tick 1: minimap off, "You board the boat and sail to <dock>." (the Icyene one says "the
    Icyene Graveyard");
  - tick 10: the move to the landing, facing as in the table;
  - tick 12: minimap on, fade in, the message box closed;
  - tick 14: the fade overlay closed.
- **Meiyerditch:** the boat is boarded from the rock beside it (3605,3163,1). On the pick's tick
  the player jumps onto the boat tile: exactmove over client cycles 28/40, facing south,
  `human_steppingstonejump` (769) with no delay and sound 2461 delayed 10 cycles. The trip starts
  on the second tick after the pick (239/4266 tick 788: fade 790, landing 800, fade in 802).
  Rev 231 played it a tick slower (231/392 tick 7363: the jump on pick+1 at 58/70, both delayed
  30 cycles, the trip at pick+4); tsps follows the newer recording.
- **Jump-onto** on the rock (`sang_boat_jump_rock`, 17958) from the boat tile: a jump north to the
  rock on the click's tick (exactmove 58/70, animation and sound delayed 30 cycles, 231/392 tick
  7213 and 231/393 tick 62), and "You jump onto the rocky wall." two ticks later.
  Clicked while already on the rock: "You're standing there!" (231/393 tick 298).

## Not covered

- Ours: picking a destination while already standing on the Meiyerditch boat tile sails at once,
  without a jump. The capture only shows a pick from the rock.
- The menus before Sins of the Father is complete (the Icyene boat appears at stage 44, Slepe's at
  80) are not changed here: those clicks stay with the quest plugins. A rev 237 recording shows a
  Burgh de Rott menu with only Meiyerditch and Icyene Graveyard, which this PR does not model.
- The rock's Climb-up (`sang_boat_wall_climb_up_rock`, 17959) is captured (231/393, 239/4266) but
  is outside this change.
