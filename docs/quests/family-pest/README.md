---
quest: Family Pest
key: family_pest
status: in-progress
tested: 2026-11-26
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# Family Pest

Aligned with a whole run of the miniquest on live, revision 242: the user's RSProx capture
`FamilyCrest + FamilyPest.bin` (local recording 1002252, SHA-256 `c03a509b...e8f75`; the start at tick 3074,
Johnathon 3203-3253, Avan 3336-3365, Caleb 3501-3536, Dimintheis 3790-3841, the gauntlets after it 3842-6221).
The plugin is `server/plugins/quests/quests/FamilyPest.Quest.js`. The words are the generated "Family Pest"
transcript (osrsreboxed-db now caches `Transcript:Family Pest`) and the four NPC transcripts' "after completing
Family Pest" sections, with the capture's wording laid over the Wiki in osrsreboxed-db's
`capture-sources.json`. Checked by `server/tests/family-pest.test.cjs` (real Player, packets, plugins, cache
and map).

## Cache facts

- Quest row 140 (`miniquest_familypest`): members, no quest points, start NPC Dimintheis (4984), completion
  value 3, requires Family Crest.
- The stage is varbit `family_quest_progress` (5347) of varp `family_quest_varp` (1418);
  `family_quest_caleb` / `_avan` / `_johnathon` (5348-5350) mark each son asked.

## Stage and flags

| Change | Set by (capture tick) |
| --- | --- |
| stage 1 | continuing "Oh come on, surely there's something I can help out with!..." (3074); no message |
| a son's flag | continuing his last line, before the player's answer (Johnathon 3231, Avan 3348, Caleb 3511) |
| stage 2 | continuing Dimintheis's "Slow down. I haven't told you what it is yet!" (3811) |
| stage 3 | "Yes" on "Hand Dimintheis 500,000 coins?" (3837): the coins go and `miniquests_completed_count` (14162) goes up on the pick; no message, jingle or scroll |

## Facts the plugin relies on

- **Menus.** While it is under way Dimintheis offers "Family Pest" / "Other" (3795) and his sons "Family
  Pest" / "Gauntlets", asked already or not (3204, 3235, 3340, 3352, 3502, 3515). "Other" and "Gauntlets" are
  Family Crest's after-quest talks.
- **The smell.** The box after a son who isn't the last asked goes by how many have been asked: the first
  "fades slightly" (Johnathon, 3232), the second "fades even more" (Avan, 3349); the last says "I do one
  quest for you all..." and "has almost faded completely" (Caleb, 3511-3512).
- **The payment** box is an objectbox with `coins_10000` (3837). Asked again after a refusal, Dimintheis
  plays the ask once more (3828-3836).
- **The gauntlets afterwards.** "How many would you like to take?" is the skillmulti menu (mode 23, as many as
  the backpack has room for, 1 preselected; 3853, 6028, 6129); the pairs come with the pick, then an objectbox
  with the pair ("Dimintheis hands you some steel gauntlets.") and the rest of the talk. A son hands his out
  at once to a player who has none of his (Johnathon 6026-6033, Caleb 6127-6130) and offers a menu to one
  holding them (Avan 6210-6221, the player holding goldsmith gauntlets).

## Recorded differences and Ours

- The Wiki's "first time" / "already talked" after the miniquest is read as having none of that son's
  gauntlets or some (carried, worn or banked): the cache keeps no flag for it, and Avan's first talk after the
  miniquest got the menu while the player held his gauntlets (6210).
- Caleb's first hand-out (6130) ended after the box on live; the Wiki's two closing lines (and Johnathon's
  6031-6033) are kept.
- **Ours:** with a full backpack the hand-out talk ends at the prompt; no recording asks then.
- **Ours:** a "Yes" picked after the coins were dropped hands nothing over and ends the talk.
- **Ours:** before the miniquest starts, the sons go straight to their gauntlets talk (no recording shows them
  between Family Crest and the start).

## Findings

- **fixed** The conversations were plugin data copied from the Wiki; they are the generated transcript now.
- **fixed** A start message live doesn't send; a completion scroll and message live doesn't send; the
  hand-out was a typed amount and a game message.

## Runs

### 2026-11-26 · agent · claude-opus-5-5

- **Tests:** `family-pest.test.cjs` plays each captured conversation through packets; the completion through
  a save and reload.
- **Not checked:** see the PR for the natural playthrough.
