# Demon Slayer

Behavior sources: [OSRS Wiki](https://oldschool.runescape.wiki/w/Demon_Slayer), [Wally's transcript](https://oldschool.runescape.wiki/w/Transcript:Wally), and rsprox captures [1723](https://rsprox.net/download/1723) and [1843](https://rsprox.net/download/1843). Capture 1723 is linked from [issue 600](https://github.com/RSPSApp/tsps/issues/600); searching the same quest identified its continuation, 1843. Both are revision 227.1 Leagues recordings. Only sanitized gameplay facts are retained here; raw recordings and player information are excluded.

## Captured facts

- Under combat level 15, Aris's first line is followed by a `Before starting this quest...` box, then the `Start the Demon Slayer quest?` Yes/No. The coin leaves when the player continues past `Okay, here you go.`, not on Yes. `demonslayer_main` advances 0→1 as the vision ends, in the tick Aris says `Delrith will come forth...`. It advances 1→2 after Prysin's `I gave the other to the wizard Traiborn.`, stays 2 through keys and battle, and completes at 3.
- Wally and Aris repeat the same five-word order, sent as varbits on the incantation line. The Wiki establishes that the order is random for each player.
- Wally's vision: Continue on `So how did Wally kill Delrith?` fades to black (interface 174, script 948); 5 ticks later the player is at (3225,3371) as Wally with music 196, the cameras and a fade in. His charge begins at (3225,3363), runs to (3227,3367), then animation 4603. Continue on the incantation fades to black; 4 ticks later the overlay closes on the sword pose (4604, graphic 778, jingle 152). Continue on Aris's `By reciting...` fades out; 4 ticks later the player is back, and a tick later the quest starts, the fade lifts and the area's music returns.
- Pouring water into the palace drain plays animation 827 and sounds 2982/2983, returns an empty bucket, sends `You pour the liquid down the drain.`, advances `delrith_drain_key` 0→1, and opens the player's sewer-key line.
- Traiborn's ritual: on `Wings of dark...` he plays 4602 with graphic 777 facing (3111,3163,1), where wardrobe 17434 appears. After Continue: 536 at +2, loc animation 4600 and the key at +4, wardrobe gone at +14. Keys and Silverlight use item boxes; bones use a message box.
- Prysin's case, from Continue on `Excellent!`: he walks to (3204,3470) and is at the case (3204,3469) at +2 with the player at (3204,3470); 4597 (delay 19) at +4; loc 4596 at +9; `delrith_silverlight_case` 0→1, form 5084 and 4598 at +12; 4606 at +15; 4607 at +16; form back, 4608, the player's 4604 with graphic 778, and the sword at +17. Silverlight enters the inventory.
- The summoning runs in an instance. Four chanting actors, stone table 17436 with 4622 at +1, 17437 at +6, 17438 at +11, all four saying `Arise, Delrith!`, Delrith at (3227,3369) with 4623 at +6. They face him on `Ha ha ha!`; the wizards face the player on `Who's that?`; Denath walks east to (3239,3368) on his last line and stays. `delrith_seen_summoning_cutscene` becomes 1 on Continue, and the first wizard attacks. Each wizard killed counts in `delrith_dark_wizards_killed`.
- The summoners' lines use `qip_ds_young_dark_wizard2` (5087) with `chathap1` for `Dark wizards` and `qip_ds_young_dark_wizard1` (5086) with `chatshock1` for `Who's that?`. Delrith walks off the altar to (3227,3367) before that line; Delrith waits until attacked.
- Attacking without Silverlight wielded sends `I'd better wield Silverlight first.` to chat only. At 0 Hitpoints the same actor becomes weakened Delrith and the player says `Now what was that incantation again?`. A tick after each word is picked, the player says it overhead and in a line with no Continue; the next menu, or the vortex after the last word, follows 3 ticks later. Correct answers: 4624 with a no-Continue box, 16 ticks later Delrith is gone, the summoning flag resets and `...back into the dark dimension...` waits for Continue. Then the player is at (3226,3368) with the pose and glint, jingle 152 and the scroll. The Wiki's `You scurry away...` message is not in the capture.

## Cache checks and implementation

Revision 241 gamevals confirm shared varp 222: stage varbit 2561 occupies bits 0–4; incantation varbits 2562–2566 occupy bits 5–19; case 2567, drain 2568, summoning 2569 and wizards-killed 2572 share the rest. Stage updates preserve the sibling fields. The persisted random incantation is rendered in both characters' dialogue and synchronized on login. Existing internal saved stages are preserved while client state uses captured values 0, 1, 2 and 3.

The vision and final battle use private Areas over the real map, with local actors, scenery and controls. Scene intervals follow scene actions; player reading time is not replayed. Leaving or logging out clears scenes and restores the player's model and camera. Rovin and Traiborn recognize banked keys. Partial bone deliveries update dialogue counts, and bones can be used directly on Traiborn. Searching the drain plays the Wiki's lines only while the key is there; a pour flushes it only at stage 2.

## Verification and remaining limits

Run from `server/` after building:

```sh
node --test tests/demon-shield-parity.test.cjs
node --test tests/qh-f2p-varrock-parity.test.cjs
QUEST_FILTER=DemonSlayer,ShieldOfArrav node --test tests/quest-dialogue.test.cjs
```

Not captured, from the Wiki or unverified: the sewer pickup and its tile (3227,9898), searching the drain, partial bones, lost-key and lost-sword recovery, a wrong incantation, and the journal. The 100-tick weakened timeout is not established by either recording (41 ticks passed without expiry). `There is no reason to pour water there.` after Silverlight has no source.

Known differences: live runs the vision and battle in instances, closes the side tabs during both, and doubles damage to Delrith with Silverlight wielded (Wiki); the last stone-table state 17454 is not placed because the player leaves 2 ticks later. The 100-tick weakened timeout is kept; neither recording establishes it. Following the Wiki, a weakened Delrith left that long is gone until the player leaves the stone circle and comes back, and the weakened form can neither attack nor be attacked, so a hit already on its way leaves him at 1 Hitpoint.
