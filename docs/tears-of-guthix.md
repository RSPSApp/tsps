# Tears of Guthix

The weekly activity lives in `server/plugins/minigames/tearsofguthix/`; the quest
remains in `server/plugins/quests/quests/TearsOfGuthix.Quest.js`.

Behaviour follows the [OSRS Wiki activity guide](https://oldschool.runescape.wiki/w/Tears_of_Guthix_%28minigame%29),
[quest walkthrough](https://oldschool.runescape.wiki/w/Tears_of_Guthix#The_Light_Creatures)
and [Chasm of Tears](https://oldschool.runescape.wiki/w/Chasm_of_Tears).

- Juna checks the completed quest, two free hands, UTC seven-day cooldown and
  one new QP or 100,000 XP again when the admission dialogue ends. The first visit
  needs no new adventures. The completed quest journal reports both remaining
  days and XP/QP requirements. Opted-in reminders appear once per UTC day on login.
- Each visit gets its own `PrivateArea`, temporary stream decorations, bowl and
  countdown. All visits follow the same world stream sequence. Time is one tick
  per QP. A normal exit awards the lowest eligible skill once, including the hard
  Lumbridge diary bonus and personal best. Logout, disconnect, death before the
  reward, and shutdown discard the visit and remove its temporary state. Death
  cleanup happens before item protection/drop calculations, so the temporary bowl
  cannot become a kept item.
- A lit sapphire lantern attracts the light creatures over the chasm; both
  Attract and item-on-NPC work. The recorded attract line plays, the player
  floats up (2046), and after four ticks lands on the far side with the
  float-down animation (2047): 3224,9504 from the north ledge, 3224,9530 back
  from the south. The chasm rocks are one-tile east/west slope steps (6672 on
  the south shelf, 6673 by the north ledge), not a teleport to Juna's path. The
  static spawns now use the cache's `tog_light_creature_op` (5435), replacing
  the `tog_light_creature_carrying` (5784) form that has no Attract option.
  `npc-spawns.json` is maintained world data, as documented in [npc-spawns.md](npc-spawns.md).
  While Guthix Sleeps retains its separate northern creature and descent.

Cache identifiers were checked with `lookup-gameval.ts`: `tog_light_creature_op`
5435, `tog_player_float_up` 2046, `tog_player_float_down` 2047,
`tog_player_float_across` 2048, `tog_climb_slope_down` 2050, lit sapphire
lantern 4702, south rocks 6672 and north rocks 6673. No generated Wiki JSON was
changed.

Verification:

```sh
cd server
yarn build
node --test tests/tears-of-guthix.test.cjs tests/tears-of-guthix-chasm.test.cjs tests/loc-teleports.test.cjs tests/quest-plugins.test.cjs
```

The focused tests cover final admission checks, weekly eligibility, journal
status, daily reminders, lantern requirements, the chasm crossing and rock
steps, private concurrent visits, shared stream colours, exact QP countdown,
diary XP once, logout, disconnect, death and shutdown cleanup.
The 459 quest-plugin, 12 minigame and 3 crossing tests passed.

Live MCP checks: the crossing was rechecked on slot 31 (`3131` client, `43731`
game, `49831` agent MCP). With a supplied lantern, ordinary Attract and
Climb/walking: a missing lantern was refused with the recorded line, the
crossing landed at 3224,9504,2 after the float-up/down, the south climb stepped
3238,9498,2 to 3240,9498,2, and walking returned to Juna. The activity account
checks used slot 18 and started from an explicitly prepared quest-complete
checkpoint with 44 QP. Story admitted
it to a private cave with the equipped bowl, 44-tick countdown and drifting
streams. A wall click collected tears, teleporting was refused, and timeout
returned it outside with 18 tears, 180 Strength XP and PB 18. The next Story
attempt was refused for seven days.
The same refusal survived a server restart and relog. A second prepared account
disconnected during collection, rejoined outside with no bowl or countdown, and
was immediately eligible to retry.

Limits: the four-tick float duration is the reference source's; the recordings
pin the animations, message and landings. Gaps between the six stream moves
still need a live OSRS capture; the code marks those estimates with `shortcut:`
comments. The rock step does not play the 2050 climb animation yet. No browser
animation/overlay capture was made. The separate quest-helper branch also
touches Tears travel and will need normal merge review.
