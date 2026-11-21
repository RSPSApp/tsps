# Crombwick Manor (Slepe)

`server/plugins/areas/CrombwickManor.plugin.js`, tests in `server/tests/crombwick-manor-doors.test.cjs`.

Crombwick Manor's front doors (`slp_mansion_door_l`, `slp_mansion_door_r`, both "Doors" with
Open) never open. The OSRS Wiki (Slepe): "As the entrances to the manor are locked, it is only
accessible via the ladder in Kroy's laboratory in the Sisterhood Sanctuary."

From rsprox captures 227/1000270 (tick 6370, left leaf) and 231/391 (tick 2613 right leaf,
tick 5210 left leaf):

- The player walks to the door. The tick after arrival a message box (229) says
  "The door is locked." and the player faces the door.
- The door stays shut and the player doesn't cross. Nothing else is sent.
- The recorded clicks look like they came from inside the manor (reached by Kroy's laboratory
  ladder): `face_angle` 0 (south) at the door's north edge. Open from Slepe (south of the door)
  gives the same box, following the Wiki's "the entrances to the manor are locked".

Not covered: the inside of the manor and Kroy's laboratory ladder.
