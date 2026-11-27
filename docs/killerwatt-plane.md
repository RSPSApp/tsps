# Killerwatt plane

The plane of Killerwatts, reached through Professor Oddenstein's portal machine on Draynor Manor's top floor once
Ernest the Chicken is complete, on members worlds. Killerwatt combat is in [killerwatt.md](killerwatt.md).

**Sources:**
- **The OSRS Wiki:** [Portal machine (revision 15334269)](https://oldschool.runescape.wiki/w/Portal_machine?oldid=15334269):
  "After completion of the Ernest the Chicken quest, on members worlds, the machine opens a portal that leads to the
  Killerwatt plane." [Killerwatt plane (revision 15375654)](https://oldschool.runescape.wiki/w/Killerwatt_plane?oldid=15375654):
  players leave "via the portal home going back to Professor Oddenstein's room".
  [Portal Home (revision 14139128)](https://oldschool.runescape.wiki/w/Portal_Home?oldid=14139128) and
  [Transcript:Professor Oddenstein (revision 15248067)](https://oldschool.runescape.wiki/w/Transcript:Professor_Oddenstein?oldid=15248067),
  the warning without insulated boots.
- **The cache (rev 242):** the locs, the varbit and their gameval names below.
- **rsprox captures:** none of the crossing. The archive has no recording with locs 11354-11357, varbit 1766 or a
  Killerwatt (469, 470). Varp 661 is in many recordings, as it also holds the Slayer master and points; none of them
  was decoded for this.

## Before

The map places the portal between the two machines, but nothing set the varbit that shows it, so nobody saw it,
and nothing answered Enter on it or on the plane's Portal Home. The plane, its 26 Killerwatts and their combat were
there, reachable only with `::tele`.

## Now

`server/plugins/areas/KillerwattPlane.plugin.js`, a members plugin:

- **The portal:** the map places `draynor_killerwatt_portal_hidden` (11355, 2x1) at (3110, 3362, 2), between the two
  `draynor_killerwatt_portal_machine` (11357) locs. Varbit 1766 (`slayer_killerwatt_portal_check`, varp 661 bit 0)
  shows it as `draynor_killerwatt_portal` (11354, "Interdimensional rift", Enter) at 1 and hides it at 0. The plugin
  sends 1 once Ernest the Chicken is complete and 0 before, at login and on every stage change of the quest, so
  `::quest ernest reset` hides it again.
- **Clicking it** (`client/game/scene/SceneRaycaster.ts`): the rift's swirl (seq 3174, as the house portal's) starts
  from a frame shrunk to one point. The scene animates the rift under the form it draws (11354), and the raycaster
  looked its animation up under the map's id (11355), so it click-tested that first frame and the drawn rift had no
  Enter. It now also looks under the drawn form's id.
- **Enter, insulated boots worn** (by item name, as in [killerwatt.md](killerwatt.md)): the player moves to
  (2677, 5214, 2), beside Portal Home.
- **Enter without them:** Professor Oddenstein's warning, the generated transcript's
  `attempting-to-enter-the-interdimensional-rift-without-wearing-insulated-boots`. Both answers that go on anyway end
  on its action "The player enters the portal machine into the Killerwatt plane.", which moves the player to the same
  tile. The other answers leave the player in the room, and so does a quest reset while the warning is open. The
  historical variant, the epilepsy warning removed on 21 February 2024, is not played.
- **Portal Home** (`draynor_killerwatt_portal2`, 11356) at (2678, 5214, 2): Enter moves the player to (3110, 3363, 2),
  in front of the portal.
- **Free-to-play worlds:** the plugin is not loaded there, so the portal stays hidden.
- **Slayer's varp:** varp 661 also holds the Slayer master and points, and Slayer saves it and sends it again at login
  (`server/plugins/skills/slayer/State.Slayer.js`). That restore now takes only Slayer's own bits from its snapshot,
  so it no longer hides the portal again after a relog.

## Not covered

- Ours: the crossing itself. The move plays no animation, sound or fade, and both landing tiles are the Shortest Path
  transports' (`server/plugins/agent/data/transports.json`); both are walkable. A [YouTube video of the crossing](https://www.youtube.com/watch?v=q3Pt2K8rG6g) into the plane
  shows no player animation and the player beside Portal Home on arrival, matching the landing tile. It is not a
  packet recording, so sound, any fade and the exact tick timing remain unverified.
- Ours: when live sends the varbit. The plugin sends it at login and when the quest's stage changes, which is what
  shows the portal to players who completed the quest.
- The plane's other rules on the Wiki, such as the dwarf multicannon ban, were not checked.

## Verification

`node --test tests/killerwatt-plane.test.cjs` (after `yarn build`) clicks the map's own locs with real packets, every
plugin loaded: the portal hidden before the quest, shown on completion and after login, and hidden again after a
reset, also with a saved Slayer snapshot of varp 661; Enter with the boots worn, with them only carried, each of the warning's four endings, a reset during the
warning, and Portal Home's Enter. With the plugin's `register` emptied, 11 of its 15 tests fail. The other four pass
either way: the click on the hidden portal, and three checks of the data and the export.

`yarn test multiloc-animation-pick` (in `client/`) builds Draynor Manor's map square with the portal open and checks
that the raycaster finds the rift's animation from the map's id, and that a click through its middle hits on a later
frame and misses on the first. It fails without the raycaster change.
