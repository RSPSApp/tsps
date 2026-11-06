# Pets progress audit

27 October 2026; checked against main2c8cf71af. The rendered progress page loads its tracker from
[osrs-progress.json](https://rsps.app/assets/extensions/rsps-world-auth/osrs-progress.json).
Its historical notes need comparison with current sources before implementation.

## Verified existing sources

The generated `npc-drops.json` has these pet rows in `tertiary`: Nexling26348 (`nex`,1/500),
Muphin27590 (`phantom_muspah`,1/2500), Kalphite princess12647 (`kalphite_queen`,1/3000),
Vorki21992 (`vorkath`,1/3000), Scurry28801 (`scurrius`,1/3000) and TzRek-Jad13225
(`tz_tok_jad`,1/200; Fight Caves separately adjusts Slayer-task odds). Their older
missing-source notes do not justify adding duplicate rolls. These are source-presence
checks, not a fresh encounter-by-encounter probability certification.

Olmlet has its 1/53 unique-reward roll in `minigames/cox/Rewards.ChambersOfXeric.js`;
Lil' zik has a standing-weighted roll in `minigames/tob/Rewards.TheatreOfBlood.js`;
Tumeken's guardian uses the raid pet-winner and shared pet award event in
`minigames/toa/Loot.TombsOfAmascut.js`; Jal-Nib-Rek uses the completion award in
`minigames/inferno/Run.Inferno.js`. Absence from NPC drop JSON is expected for scripted
sources. Chest delivery, ownership and exact rate modifiers need their own audit.

## Verified change in this branch

Chompy chick already has a generated1/500 entry, but the award gate used a never-set
diary flag and plucking did not request its roll. See `chompy-pet-acquisition.md`.

## Remaining work and ownership

- Bloodhound (5 November 2026): the master casket's 1/1,000 tertiary goes through
  `pets:award` (follower, backpack or Probita, once per family) instead of the reward
  screen. A master casket that becomes the Mimic rolls no tertiaries (`Reward.Mimic.js` asks
  `treasure-trails:roll-casket`, the base table only), so it never gives the Bloodhound or the
  tertiary master clue; that predates this change. Its cache "Dig" follower option (Wiki: a spade for clue steps) is not wired: the
  spade's clue digs answer every `onCanUseItem` spade hook, quest digs included.
- Penance Princess: the high gamble reads the Barbarian Assault match's recorded Queen kills
  and per-role Honour Points (500, Wiki "Barbarian Assault/Gambles"). The high gamble's
  extra elite clue roll is a Barbarian Assault gap, not a pet one.
- Cats (5 November 2026): Felkrash trains an overgrown cat (or overgrown hellcat) into a wily
  cat at Ratcatchers completion and afterwards, one wily or lazy cat at a time (menagerie
  excepted). A wily cat turns lazy within an hour of follower time; about 15 rats retrain it
  4-6 growth ticks later. An adult, wily or lazy cat's seventh hell-rat makes its hell form
  unless a hellcat is held outside the menagerie; the cat keeps its age and retraining
  progress (Wiki "Hellcat", Mod Ash). Milk reverts every hell stage. Overgrown cats still
  catch vermin at 75%, which predates this change and contradicts Wiki "Overgrown cat"
  ("will lose its ability to catch vermin"); they get no hell-rat route here. Not modelled: the activity-level
  catch bonus, the hell-rat behemoth route (no Rat Pits),
  kalphite larva/butterfly catches, and exact transformation messages (no capture or Wiki
  text; only the hellcat line is shown, matching the hell-kitten one).
- Felkrash names a carried or following wily or lazy cat after Ratcatchers. The six-letter
  name is shared by these cat forms and appears in her naming conversation; it persists in
  the player save. The first naming defaults to `AAAAAA`; later opens restore the saved
  name. The arrows cycle `A`-`Z` and space. That default and cycling order are TSPS policy,
  not a recorded retail timing or UI claim.
  Cat and hellcat dialogue beyond the naming conversation remains outside this feature.
- Probita already reclaims recorded missing pets freely. The current
  [Probita Wiki page](https://oldschool.runescape.wiki/w/Probita) dates free reclaim to
  10 September2025. Do not add the obsolete one-million-coin fee. A native recovery screen
  is a separate interface gap, rather than a reason to change the current price.
- Followers already have teleport/plane catch-up; obstacle/door pathing remains a separate
  investigation. Generic pet interaction transcript gaps require canonical dialogue data.
- Existing skilling and metamorphosis tracker tasks are marked done. That status is not a
  claim that every individual variant or acquisition path has been retested here.

This audit does not mark the entire Pets category complete.
