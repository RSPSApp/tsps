# Castle Wars flag drops and returns

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
and other planes do not inherit this behavior. Stepping stones retain their existing return
rule for either standard. Tunnel drops use the current rock state described below.

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

## Tunnel rock patches

For either standard, a drop inside a tunnel's two-by-two rock footprint returns the flag
home while either rock layer (4437 or 4438) remains. With both layers cleared, the standard
drops at the matching inner floor corner just outside the patch. A north-south tunnel keeps
the carrier's column and selects the nearer north/south end; an east-west tunnel keeps the
carrier's row and selects the nearer east/west end. The carrier stays in place.

The shared drop path reads the current map objects when the drop is processed. In particular,
if an explosive collapse kills the carrier, clearing both layers before the existing death
sequence completes makes the standard drop outside the patch. Leaving either layer makes it
return home. Ordinary deaths now resolve four ticks after animation 836 starts, matching the
primary recordings below; the animation and completion-hook ordering stay unchanged.

The shared death window is established by eight normal local-player deaths, verified against
their raw appearance/animation and rebuild packets: [426](https://rsprox.net/download/426)
(ticks 1131 to 1135), [1084](https://rsprox.net/download/1084) (853 to 857),
[1085](https://rsprox.net/download/1085) (60 to 64), and five deaths in
[2508](https://rsprox.net/download/2508), each four ticks after animation 836. These return to
the normal world without a first-death scene. The previous two-tick task could complete
before a helper's second potion, returning the standard while that rock layer remained.

The three firsthand OSRS videos supplied in
[#2355](https://github.com/RSPSApp/tsps/issues/2355) establish the relative behavior:

- [Unwielding on a cleared patch](https://github.com/user-attachments/assets/96c0ec31-42ab-44bd-9d11-4df3b89929a2)
  shows all four drop positions inside the passage, outside the cleared footprint (not the
  cave-wall tiles). The 5.5, 8.5, 11.0 and 13.5 second frames show the different corners.
- [Death with rocks still present](https://github.com/user-attachments/assets/d5493eaf-fa90-4cdb-a6c6-5c2e018d6d05)
  ends with the standard Safe, visibly at 15.3 seconds. Earlier frames still show Taken;
  this is not evidence of an immediate return on collapse.
- [Clearing the rocks before death completes](https://github.com/user-attachments/assets/e37dbd73-a32f-4b13-9c82-6b783ce11623)
  shows a takeable ground standard with the passage cleared and Death still visible around
  9 seconds, followed by pickup.

The absolute tile mapping is an inference from those relative views and the active revision
241 cache geometry. It is not a packet capture of OSRS world coordinates or death tick counts.
The cache supplies four two-by-two rock anchors and their north-south/east-west orientation:
2401,9494; 2409,9503; 2400,9512; 2391,9501, all on plane 0. For anchor `(x,y)`, the inner floor
corners are `(x,y-1)`, `(x+1,y-1)`, `(x,y+2)`, `(x+1,y+2)` for north-south tunnels, or
`(x-1,y)`, `(x-1,y+1)`, `(x+2,y)`, `(x+2,y+1)` for east-west tunnels. Each footprint tile has
one nearest corner by Manhattan/Euclidean distance; Chebyshev distance would tie and must
not choose the lateral column/row.

The cave walls (4448) occupy boundary-wall slots at the outer corners. Those literal wall
anchors are blocked and the attempted native flag pickup there cannot reach the standard.
The inner floor corners support a separate type-10 standard and native pickup at all sixteen
positions without changing the wall objects or clipping.

`tests/castlewars-tunnel-collapse.test.cjs` covers real item-on-object clearing/collapse,
equipment Remove, movement/pickup and World-driven lethal damage/death completion for both
standards across the four patches. It also checks full versus half rock layers, relocated
drop overlap, actor positions, object ownership and preserved wall collision. The static
footprint helper still forbids barricades on cleared patches. Related navigation tests retain
capture, own-flag return, stripped-banner and overlapping-standard controls. These paths are
also checked through the worktree's running server MCP: all sixteen cleared-patch unwield
positions and collapse/clear/death at each of the four patches. The latter keeps the carrier
dying until both layers clear and leaves a takeable corner standard after respawn. It does not
claim a new browser/GPU or live OSRS replay.
