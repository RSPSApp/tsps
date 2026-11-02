# Movement stopping and animation stalls

What stops a player's walk, and what only stalls the animation, resolved for the spade and
home teleport reports in issue #1811. Behaviour comes from the OSRS Wiki and live RSProx
recordings; no action was changed on guesswork.

## The engine rule

The Wiki separates two things ([Animation stall](https://oldschool.runescape.wiki/w/Animation_stall)):

| Stall | Movement | Actions | Examples |
| --- | --- | --- | --- |
| **Partial** | Continues on the true tile | Allowed | Digging, Vengeance, Spellbook Swap, most teleports, weapon swings |
| **Full** | Blocked | Blocked, hits are held | Skillcape emotes, some shield activations |

A partial stall is visual only: the client withholds the character's steps while the sequence
plays, then catches them up (the rubber band). The server keeps walking the true tile
underneath. `AnimationStalls.plugin.js` exists for the full-stall rows; nothing here promotes a
partial stall to one.

## Findings

| Action | Stops the walk? | In this server |
| --- | --- | --- |
| Spade `Dig` | **No** — partial stall (`human_dig` 830, synth 1470) | `Spade.plugin.js` plays the sequence and leaves the walk queue alone |
| Home teleport | **No** — the long cast cannot *start* while walking | `startHomeTeleport` refuses a moving click and leaves the route intact |
| Teleport spells, tablets, jewellery | **Yes** — hard interruption | `TeleportHandler.teleport` blocks and resets movement (unchanged) |
| Combat spell on a target | Stops when the attack resolves | Combat owns the approach and the attack (unchanged) |
| Food, potions, equipment | No | Left alone |
| Alchemy, drop item | No | Left alone |
| Bury bones, scatter ashes | No — animation only | Left alone |
| Using an item on another item/NPC | No | Left alone |
| Emotes / full-stall items | Yes (full stall) | `AnimationStalls.plugin.js` (unchanged) |

Two earlier assumptions were wrong and are recorded here so they do not come back:
movement is *not* cleared by a spade dig, and it is *not* cleared by clicking a home teleport.

## Recording evidence

Captures are the decoded recordings in the local RSProx archive. Tick numbers are the capture's
server ticks.

- **1858**, ticks 34805-34808: a walk click lands the player on 1756,4940; the next click is the
  spade's `Dig` (`inventory:items`, obj 952, op 2) and the server sends `SequenceExtendedInfo(830)`
  with synth 1470. The player walks again on the following tick. The dig neither teleports the
  player nor clears the route.
- **1858**, ticks 31332-31333: the same `Dig` click sends sequence 830 at the tile the player just
  walked onto, with no movement reset packet.
- **3275**, ticks 30555 and 30625: the shared dig sequence `human_dig` (830) is sent on a local
  player entry that is `HighResolutionMovement`, with further movement ticks after it — the
  client-side half of a partial stall.

The relevant `SetMapFlag(x=..., z=...)` packets in these captures clear the client's clicked-tile
flag (the click was consumed), not the server's walk queue.

## Code

- `server/plugins/items/Spade.plugin.js` — the shared `Dig` handler for Spade, Large spade and
  Eastfloor spade. It returns `false` on purpose: the event stays open for treasure-trail,
  Barrows, quest and sailing dig handlers, which play their own sequence.
- `server/plugins/combat/HomeTeleportSequence.js` — `standingStill` gates the cast. The busy
  varbit is cleared so a minigame teleport list opened before the walk does not stay stuck.
- `server/plugins/combat/AnimationStalls.plugin.js` — full-stall rows only (unchanged).
- `server/src/main/typescript/elvarg/game/model/teleportation/TeleportHandler.ts` — the movement
  stop that teleports actually need (unchanged).
