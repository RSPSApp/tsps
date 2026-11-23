# Zamorak godsword special (Ice Cleave)

Extracted from the rev 241 cache, with what the server's `ZamorakGodsword.SpecialAttack.js` plays.

| File | What | Cache id |
| --- | --- | --- |
| `player.dat` | A player to animate: the default male body kits (head 3, jaw 14, torso 18, arms 26, hands 34, legs 38, feet 42) and the Zamorak godsword's male wear model (27653), joined into one model with their labels | models 217, 246, 28515, 26632, 10218, 27639, 181, 27653 |
| `player-anim/` | The player's animation, `zgs_special_player`: 25 frames, 53 ticks, frame map 0 (the player skeleton). In the cache it also puts item 11808 (the godsword) in the right hand and empties the left hand while it plays; this copy has those two settings removed, so the player keeps their own weapon and shield | sequence 7638 |
| `graphic/` | The sword trail, recoloured violet (below): `spotanim.dat`, `model.dat` and its animation `dh_sword_update_zamorak_special_spotanim` in `graphic/anim/` (40 frames, 53 ticks, mostly fading parts of the trail in and out) | spot animation 1210, model 28085, sequence 7051 |
| `preview.png` | Every 4th tick of both, rendered from the Blender preview | |

The block of ice on the target is a different graphic (369) and isn't included.

In Blender (with the three add-ons installed, see `../README.md`):
1. File > Import > OSRS model (.dat): `player.dat`.
2. With it selected, File > Import > OSRS animation: `player-anim/seq.dat`. This makes the rig
   `zgs_special_player rig`: Body, Torso, Head, both arms down to the hands, the Weapon (the
   godsword, in the right hand) and both legs, plus small scale bones (the Body stretches slightly
   upward during the swing).
3. File > Import > OSRS graphic: `graphic/spotanim.dat`. This makes `gfx 1210 rig`: Trail (it
   moves) and Section 1-19, a chain of trail pieces that each grow from nothing (scale), with
   Fade 1-20 and Fade all in Tool Shelf > OSRS.
4. Both start on frame 0 and last 53 ticks, as they play together in game. Play the timeline, or
   pose a bone in Pose Mode and key it.

The body kits keep their default colours (the game recolours them with the player's chosen
colours). Blender doesn't apply the graphic's lighting (ambient 30), so the trail looks darker
than in game.

`graphic/model.dat` is recoloured to the hue of the Ancient godsword special's graphic (hue 49, a
violet; `../ancient-godsword-special/graphic/`). Each colour keeps its saturation and lightness:

| Faces | Cache colour | Now |
| --- | --- | --- |
| 130 (the trail) | 2995: hue 2 (orange), saturation 7, lightness 51 | 51123: hue 49, saturation 7, lightness 51 |
| 84 (its pale edge) | 64741: hue 63, saturation 1, lightness 101 | 50405: hue 49, saturation 1, lightness 101 |

The cache's orange model is in git history (commit 0dd87d74f). `preview.png` still shows it.

In game, these are custom animation 50000 (`zgs_special_keep_weapon`, the player's swing),
custom animation 50001 (`zgs_special_trail_spotanim`) and custom graphic 50000
(`zgs_special_trail`, the trail, model 1900000), listed in
the cache editor's assets (`server/data/definitions/custom-definitions.json`). Try them with `::anim 50000` and `::gfx 50000`.

Blending with movement: the cache's sequence hands only the newer player skeleton's legs, cape and
body to the walk or run animation (its interleave list, opcode 3). Walk and run animations on the
older skeleton (the default 819/824, the Exalted Spring's 14252/14254) move none of those, so the
legs froze. This copy's list also names the older skeleton's whole body, legs and cape (slots 1, 2,
9, 11, 13, 15, 17, 19, 37, 39, 41, 43, 45), as the Ancient godsword special already does.
