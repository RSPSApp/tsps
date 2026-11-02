# Castle Wars catapult flag returns

At the catapult flag-return corners, a carrier dropping their own team's standard returns
it home. An enemy-carried standard stays on the ground. A defender picking up their standard
at their own catapult returns it; an attacker can pick it up and keep carrying it. Pickup
uses the dropped standard's tile, so standing beside the corner does not change its owner.
The shared drop path covers deaths, stripped banners and equipment changes.

The eight reported corners in [#1961](https://github.com/RSPSApp/tsps/issues/1961) are:

| Base | Tiles on plane 0 |
| --- | --- |
| Zamorak | 2383,3116; 2384,3116; 2387,3118; 2387,3119 |
| Saradomin | 2412,3088; 2412,3089; 2414,3091; 2415,3091 |

The existing mirrored corners at 2385,3116 and 2416,3091 remain supported. Other deck tiles
and other planes do not inherit this behavior. Stepping stones and tunnel rocks retain
their existing return rules for either standard.

Evidence and limits:

- The [OSRS Wiki flag-holding section](https://oldschool.runescape.wiki/w/Castle_Wars#Flag_holding)
  documents own-flag returns inside the owner's castle, including pickup of a dropped flag.
  It does not specify these catapult corners.
- [Raiderej's Tip.It post dated 8 July 2007](https://forum.tip.it/profile/149302-raiderej/content/)
  explicitly names the catapult among places where a flag returns when dropped. This is
  historical evidence from original RuneScape, not verification of current OSRS's exact tiles.
- The exact coordinates and own-carried/enemy-carried distinction follow the reporter's
  clarification in #1961. They still need a current OSRS recording or controlled test.

Native Player regressions in `tests/castlewars-navigation.test.cjs` cover both teams at every
supported corner, stripped banners, both pickup outcomes, adjacent pickup, full inventory,
nearby deck tiles and other planes. The barricade/tunnel suites retain their return checks.
