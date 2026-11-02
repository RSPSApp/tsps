# Demon Slayer

Behavior sources: [OSRS Wiki](https://oldschool.runescape.wiki/w/Demon_Slayer), [Wally's transcript](https://oldschool.runescape.wiki/w/Transcript:Wally), and rsprox captures [1723](https://rsprox.net/download/1723) and [1843](https://rsprox.net/download/1843). Capture 1723 is linked from [issue 600](https://github.com/RSPSApp/tsps/issues/600); searching the same quest identified its continuation, 1843. Both are revision 227.1 Leagues recordings. Only sanitized gameplay facts are retained here; raw recordings and player information are excluded.

## Captured facts

- The reading opens a `Start the Demon Slayer quest?` Yes/No confirmation and costs one coin on acceptance. After Wally's vision ends, before Aris's follow-up discussion, `demonslayer_main` advances 0→1. Asking Prysin for access to Silverlight advances 1→2. It remains 2 throughout the key collection and final battle, then completes at 3.
- Wally and Aris repeat the same five-word order. This player's order is Gabindo, Camerinthum, Aber, Purchai, Carlem. The Wiki establishes that the order is random for each player.
- Wally's vision takes the player to (3225,3371), changes the historical actor's appearance, and uses music 196. His charge begins at (3225,3363), runs through (3226,3365) to (3227,3367), then plays animation 4603. The final pose uses animation 4604 and graphic 778. The vision restores the player's original appearance and location.
- Pouring water into the palace drain returns an empty bucket, sends `You pour the liquid down the drain.`, advances `delrith_drain_key` 0→1, and opens the player's sewer-key dialogue. Capture 1843 begins with that flag at 2 after collection.
- Prysin opens the Silverlight case (`delrith_case_open` 0→1) and gives item 2402. In this recording Silverlight enters the inventory; it is not automatically equipped.
- The final summoning has four chanting actors, temporary stone-table scenery, Denath's dialogue, camera movement and shake, and Delrith appearing at (3227,3369) with animation 4623. `delrith_summoning_cutscene` becomes 1 when Denath leaves.
- The summoners' lines use `qip_ds_young_dark_wizard2` (5087) with `chathap1` for `Dark wizards` and `qip_ds_young_dark_wizard1` (5086) with `chatshock1` for `Who's that?`. Delrith walks off the altar to (3227,3367) before that line. When Denath leaves, 5086 turns on the player and casts at once, at any combat level; Delrith waits until attacked.
- Depleting Delrith's Hitpoints transforms the same actor into weakened Delrith. The player automatically says `Now what was that incantation again?`, then chooses five individual words from a `Select a word` menu. Correct answers trigger animation 4624 and two narrative statements before completion. The summoning flag resets to 0, and the player returns to (3226,3368) with the Silverlight pose and glint.

## Cache checks and implementation

Revision 241 gamevals confirm shared varp 222: stage varbit 2561 occupies bits 0–4; incantation varbits 2562–2566 occupy bits 5–19; case flag 2567, drain flag 2568 and summoning flag 2569 share the remaining fields. Stage updates now preserve the sibling fields. The persisted random incantation is rendered in both characters' dialogue and synchronized on login. Existing internal saved stages are preserved while client state uses captured values 0, 1, 2 and 3.

The vision and final battle use separate private Areas, with local actors, scenery and controls. All recorded camera targets, heights, both movement-rate fields, shake settings and resets are reproduced. Wally's charge holds its unclickable line for eight ticks before the next camera; the incantation Continue leads to the sword-pose camera four ticks later. The summoning includes its opening sideways pan, spell camera, shake at +2/+3, rising look target at +6, Delrith's southward steps at +12/+13, return shot at +13 and resumed dialogue at +14, followed by Denath's retreat pan on his departure line. These intervals follow scene actions; player reading time is not replayed. Leaving or logging out clears scenes and restores the player's model and camera. Delrith remains visible without Silverlight wielded, but attacking requires the sword. A wrong incantation restores his combat form; success completes the quest once. Rovin and Traiborn recognize banked keys. Partial bone deliveries update dialogue counts, and bones can be used directly on Traiborn.

## Verification and remaining limits

Run from `server/` after building:

```sh
node --test tests/demon-shield-parity.test.cjs
QUEST_FILTER=DemonSlayer,ShieldOfArrav node --test tests/quest-dialogue.test.cjs
```

The focused tests exercise state preservation, banked keys, bone deliveries, private vision cleanup, summoning, wrong and correct five-word answers, completion, every vision camera packet, and the complete summoning camera timeline. They verify server behavior; no live visual comparison of these two cinematic sequences has yet been completed.

Fade overlays, original appearance equipment details, Prysin's cabinet-opening choreography, and the exact post-flush sewer-item lifetime remain unverified. The existing 100-tick weakened timeout is retained; neither recording establishes it. Following the Wiki, a weakened Delrith left that long is gone until the player leaves the stone circle and comes back, and the weakened form can neither attack nor be attacked, so a hit already on its way leaves him at 1 Hitpoint. These limits prevent a claim of complete visual and packet-timing parity.
