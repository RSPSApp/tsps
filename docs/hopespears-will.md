# Hopespear's Will

Miniquest after Land of the Goblins: `server/plugins/quests/quests/HopespearsWill.Quest.js`.

## What live does (rsprox captures)

Recording 1702 (rev 226), ticks 4790-5673, plays the whole miniquest.

- **Hopespear**: `lotg_hopespear` (11391; multinpc `lotg_hopespear_there` 11301, seen with a
  ring of visibility) at 3744,4391 in the crypt. Talk-to plays Transcript:Ghost (Hopespear).
  Varbit 13619 `hopespear` goes 0 -> 1 on his line "You must defeat high priests without using
  any weapons, armour or spells..." (tick 4826).
- **Graves** (`lotg_crypt_priest_grave1-5`, 43122-43126): Say-name opens "Select an option"
  with the five names. The chosen name is the player's chat line (seq 9289
  `lotg_player_invokes_high_priest`). On continue: "An undead goblin high priest rises from
  the grave...", and the priest is added beside its grave (3739,4385 / 3745,4385 / 3739,4389 /
  3745,4389 / 3742,4392) with seq 9311, spotanim 2056 and sound 5333.
- **Bones**: a priest beaten unarmed dies normally and drops its bone four ticks later
  ("Untradeable drop: Snothead's bone").
- **Burial in Yu'biusk** (from 3571,4374): "You dig a hole in the ground..." (seq 827,
  sound 2738). On the next tick: "You bury the bones and feel a wave of gratitude from the
  spirit of <name>.", the bone is removed, varbit `hopespear_priest_<n>` (13620-13624) goes
  0 -> 1 and Prayer XP is paid. The fifth bone also sets `hopespear` 1 -> 2 and
  `miniquests_completed_count`. No scroll, jingle or chat line is sent.

Prayer XP per bone (OSRS Wiki, matching the capture's stat updates): Snothead 1,250,
Snailfeet 2,500, Mosschin 5,000, Redeyes 10,000, Strongbones 20,000.

## Ours

- The unarmed rule is checked when the priest dies: no worn item with any stat bonus (a staff
  for autocasting has bonuses, so a real autocast is refused; a default spell remembered with no
  staff is not), and no ring of recoil (Wiki: weapons, armour, spells and recoil). A spell cast
  earlier in the fight isn't tracked.
- A summoned priest is removed when its owner logs out.
- A name that doesn't match the clicked grave raises nothing.
- A bone buried outside Yu'biusk, or before the miniquest is started, isn't buried; the
  message is ours.
- Strongbones' skoblins are not summoned in these fights. A new kill doesn't despawn the
  previous bone.
- The start requirements (Prayer 50, Desert Treasure I, Fairytale II) aren't checked: no
  capture shows a refusal.
