# Zamorak godsword special (Ice Cleave)

Extracted from the rev 241 cache, with what the server's `ZamorakGodsword.SpecialAttack.js` plays.

| File | What | Cache id |
| --- | --- | --- |
| `player.dat` | A player to animate: the default male body kits (head 3, jaw 14, torso 18, arms 26, hands 34, legs 38, feet 42) and the Zamorak godsword's male wear model (27653), joined into one model with their labels | models 217, 246, 28515, 26632, 10218, 27639, 181, 27653 |
| `player-anim/` | The player's animation, `zgs_special_player`: 25 frames, 53 ticks, frame map 0 (the player skeleton). It puts item 11808 (the godsword) in the right hand and empties the left hand while it plays, which is why it always shows the godsword | sequence 7638 |
| `graphic/` | The orange sword trail: `spotanim.dat`, `model.dat` and its animation `dh_sword_update_zamorak_special_spotanim` in `graphic/anim/` (40 frames, 53 ticks, mostly fading parts of the trail in and out) | spot animation 1210, model 28085, sequence 7051 |
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
colours). Blender doesn't apply the graphic's lighting (ambient 30), so the trail looks redder
than the game's orange.
