---
quest: Family Pest
key: family_pest
status: in-progress
tested:
tester: agent
model: claude-sonnet-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# Family Pest

Implemented from the OSRS Wiki raw wikitext, the generated post-miniquest conversations, the revision 242 cache and one RSProx capture. Not yet played
in a client; `server/tests/family-pest.test.cjs` plays every conversation through the real transcript player.

## Sources

| Page / evidence | sha256 or id |
| --- | --- |
| [Family Pest](https://oldschool.runescape.wiki/w/Family_Pest) raw wikitext (fetched 2026-11-14) | `6276a718f35e3690d67ce70b57ccd18f5d4ca5c8716838be55f38f2402b78658` |
| [Transcript:Family Pest](https://oldschool.runescape.wiki/w/Transcript:Family_Pest) raw wikitext | `f2c08b286a37c081af5bcbc3e24a63eed30d639bb55fa0e0b155d64b6fdcae12` |
| Generated `npc-dialogues.json` variants `standard-dialogue-after-completing-family-pest` (Dimintheis, Avan, Caleb, Johnathon) | untouched, used as is |
| RSProx capture 1702 (revision 226, 2024-11-01) | menus "Family Pest" + "Gauntlets" / "Other"; "Hand Dimintheis 500,000 coins?" Yes / Refuse |

## Cache facts used

- Quest row 140 (`miniquest_familypest`): members, no quest points, start NPC Dimintheis (4984), completion value 3, requires Family Crest.
- The stage is varbit `family_quest_progress` (5347) of varp `family_quest_varp` (1418); `family_quest_caleb` / `_avan` / `_johnathon` (5348-5350) mark each son spoken to.
  The cache names no values between started and complete; this server uses 1 = Dimintheis spoke, 2 = all three sons spoken to, 3 = complete.
- None of the handled NPC ids (Dimintheis 4984/12629, Avan 386/387 and the "Man" 385, Caleb 4317/5433, Johnathon 5443/5445) is a multi-NPC parent at any stage (tested through the cache resolver).

## What it does

Start: the "Oh come on, however menial, I want to help!" branch of the existing standard conversation starts the quest (message step `jjabGL`). In progress, Dimintheis and his sons show
the Wiki's menus ("Family Pest" and "Other" / "Gauntlets", as the capture shows) and play the Wiki lines; the third son's conversation moves the quest to stage 2; Dimintheis then asks for
500,000 coins and completes it on payment. Afterwards each NPC plays the generated post-miniquest conversation: the first pair of steel / goldsmith / cooking / chaos gauntlets, then any number on
request. Defender of Varrock's Dimintheis branches that were forced to "Family Pest not completed" now read this quest's state.

## Findings

- **open** "Other" (Dimintheis) and "Gauntlets" (the sons) lead into the existing standard conversation: Dimintheis's "Other" branch, and the sons' "Can you change my gauntlets for me?" branch; whether live
  OSRS enters them the same way is not captured.
- **open** The journal text is written from the Wiki, not from a capture; the stage value 2 is this server's choice.
- **open** The "Talking to Dimintheis again before handing out the money" conversation starts after he has been asked for the money once (the flag is set at "The sweet smell ... is a distant memory").
- **open** Repeat visits' "How many would you like to take?" is a prompt opened by the plugin (the conversation engine has no input step); the hand-out line is a game message, not the generated NPC line.
- **open** Family Pest is registered before Family Crest in `QUESTS`: dialogue variant hooks run in registration order, and Family Crest answers every conversation once its own quest is done.
- **open** Not played in a client; no RSProx capture of rev 242.

## Runs

None yet.
