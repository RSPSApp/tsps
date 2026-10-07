# Warriors' Guild

The guild in Burthorpe (`server/plugins/areas/WarriorsGuild.plugin.js`, with one file per room in `server/plugins/areas/warriors-guild/`). Behaviour is from the OSRS Wiki. Where the Wiki is silent (timings, animations, some messages), it follows Near-Reality's port, with ids checked against Void's data and this server's cache. Dialogue is the NPCs' Wiki transcripts from `npc-dialogues.json`; the plugin only answers their conditions and actions.

The plugin lives under `areas/` so that its door and ladder handlers run before `objects/Doors` and `objects/Ladders`.

## How it works

- **Entry:** Ghommal's door (24318) lets in a combined base Attack and Strength of 130, or 99 in either. Boosts don't count.
- **Tokens:** the dummy, catapult and shot put rooms write tokens into the guild ledger (`warriors-guild:tokens`). Staff pay them out through "May I claim my tokens please?" or their Claim-Tokens option: Gamfred, Ajjat, Kamfreena, Shanomi, both Refs, Lorelai and Sloane. Animated armour drops its tokens on the ground instead.
- **Animation room:** a plain full helm, platebody and platelegs of one metal on a magical animator becomes animated armour.
  - It drops tokens and the armour from `npc-drops.json`. Bronze pieces each come back 9 times in 10 (a correction in `NpcDrops`), iron loses its legs 1 time in 10, and steel its helm 1 time in 10.
  - Armour left alive for five minutes, or whose owner dies or logs out, goes to Shanomi. Her "armour disappeared" transcript gives it back.
- **Dummy room:** one of seven dummies is up at a time, for 4-15 ticks. The right style or attack type gives 15 Attack XP and 2 tokens. The wrong one stuns for 3 ticks.
- **Catapult room:** Gamfred hands out the defensive shield. It can only be wielded on the target (2842, 3545, 1).
  - While it's on, the equipment tab becomes the defence styles (interface 411), and the quest, prayer, magic, options, emote and music tabs are hidden.
  - The catapult fires every 8 ticks. A block gives 10 Defence XP and 1 token.
  - Stepping off the target puts the shield back in the inventory.
- **Shot put:** the heavy doors need 50 base Strength. The north door gives 0-11 XP and the south door 0-1.
  - A shot's power is X = Strength + run energy + style (30/20/10) + 5 for dusted hands - weight (18 or 22).
  - It lands with probability X/250, otherwise it drops on the player's toe for 1 damage.
  - It flies 1-14 yards by the Wiki's X thresholds, gives X * 0.7 Strength XP, and costs X * 0.1 run energy.
  - Tokens are the distance + 1 (18lb) or + 3 (22lb).
  - Ashes ground with a pestle and mortar dust the hands for the next throw.
- **Kegs (Jimmy):** with the head and hands empty, up to five kegs are stacked (multilocs 15669-15673 on varbits 2252-2256, head items 8860-8864). The player stands and walks with animations 4179 and 4178 while balancing.
  - The stack falls more often at low run energy and hurts for 2-4.
  - Leaving the room drops the kegs with no reward.
  - Jimmy writes the keg tokens into the ledger.
- **Cyclopes:** Kamfreena's room (top floor) and Lorelai's (basement, down the ladder behind the guild) need 100 tokens. They take 10 on entry and 10 each minute, then allow one minute's grace before moving the player out. An Attack or max cape gets in free, and must stay on.
  - Top-floor cyclopes drop, at 1/50, the defender after the best one the player owned when they walked in, up to rune. Owned means carried, worn or banked.
  - The basement door needs a rune defender shown to Lorelai once (`warriors-guild:basement-unlocked`). Its cyclopes drop the dragon defender at 1/100.
  - `NpcDrops` emits `npc-drops:roll`, and the plugin removes the dump's flat defender entries and adds the right one.
  - Ranged and magic do no damage to the guild's cyclopes or animated armour.
- **Skillcapes:** Ajjat (Attack) and Sloane (Strength) sell their cape and hood for 99,000 coins at 99. The cape is trimmed with more than one 99.
- **Overheads:** Shanomi speaks in order every 15 ticks, Kamfreena at random every 50, and Jimmy while kegs are balanced.

## Data fixes

- Ghommal, Harrallak and Sloane spawned as their While Guthix Sleeps multi-NPCs (2457, 2458, 2473), which are invisible at varbit 0. They now spawn as 13613, 13615 and 13616, at the Wiki's tiles.

## Not from the Wiki

These need checking against live OSRS:

- **Keg balancing rewards.** The Wiki has no numbers, so these are Near-Reality's: Strength XP 10 × kegs and tokens 10 × kegs + ticks / 2 when a stack of two or more falls; 9 energy every 10 ticks; and the fall chance.
- **Messages with no Wiki source:**
  - Ghommal's refusal at the door, and Lorelai's at her locked door (Near-Reality's lines).
  - The heavy door's Strength message.
  - Shot put at under 5% run energy.
  - Dusting hands.
  - Wielding the defensive shield off the target, or with a weapon.
  - "You've already summoned an animated armour."
  - "You can only use melee weapons in this minigame."
- **Damage when a catapult block fails:** 1-5.

## Not done

- The Combat Achievement token multipliers (doubled or tripled), since there are no Combat Achievements yet.
- Animated armour running away at low hitpoints.
- The Ref being hit by a stray shot.
