# Baba Yaga's house

Baba Yaga lives in a walking, chicken-legged house on Lunar Isle. The house is NPC 3836 ("House", size 5, one option, Go-inside), and it wanders around its spawn at (2082, 3929). Its interior is a separate room at (2451, 4645), where Baba Yaga (3837) stands. The way out is the door, loc 16774, at (2451, 4644).

- **Plugin:** `server/plugins/areas/BabaYagasHouse.plugin.js`.
- **Test:** `server/tests/baba-yagas-house.test.cjs`.

## From the rsprox captures

These are the local rsprox.net recordings 1000187, 1000268, 1000372, 1000456, 1000463 and 1000480 (rev 227) and 1000763 (rev 228). The 1000763 run is on a normal world. The others, including every exit, are Leagues runs. The movement is the same in both.

- **Go-inside:** one tick after the player reaches the house, they are teleported to (2451, 4645, 0). There is no animation and no fade. On the next tick:
  - the camera shake starts: `cam_shake` slot 1, random 0, sine amplitude 10, frequency 25. This is the "Baba Yaga's house" camera shake in Settings (`CameraShake` effect `babaYaga`);
  - sound 1692 plays.

  Captured at 1000763 ticks 1635-1640, 1000456 tick 101, 1000463 ticks 16525/16572 and 1000480 ticks 20482/20530.
- **Door (Open):** the player faces the door. Two ticks after the click they are put back outside, next to the house wherever it has walked to. Sound 85 and a `cam_reset` come on the same tick.

  The five captured exits land on a tile diagonal to the house's south-west corner:

  | Recording, tick | House | Landing | Offset |
  | --- | --- | --- | --- |
  | 1000456 t109 | (2084, 3928) | (2085, 3927) | +1, -1 |
  | 1000480 t20489 | (2082, 3929) | (2081, 3930) | -1, +1 |
  | 1000480 t20594 | (2084, 3928) | (2083, 3929) | -1, +1 |
  | 1000463 t16532 | (2082, 3930) | (2081, 3929) | -1, -1 |
  | 1000463 t16642 | (2083, 3930) | (2084, 3929) | +1, -1 |

- **Leaving another way:** a Teleport cast inside the house (1000456 tick 190) also gets a `cam_reset` when the player arrives.

tsps runs loc options one tick after the arrival (see `HANDLER_TICK` in LocTeleports), so the door's move is one tick after its handler. NPC options run on the arrival tick, so the house's move is also one tick after its handler.

## Ours

- **Exit tile:** each exit lands on one of the three captured offsets, picked at random. A blocked tile is skipped. With no House NPC in the world, the exit uses the house's spawn instead.
- **Interior area:** the interior is an Area (2445-2457, 4640-4652). Leaving it any way sends the camera reset once.
- **Logging in inside:** this does not start the shake again. No capture shows a login inside the house.
- **Lunar Diplomacy:** the quest no longer spawns a stand-in Baba Yaga outside the house. The player talks to her own spawn inside.
