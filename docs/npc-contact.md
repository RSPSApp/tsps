# NPC Contact

The Lunar spell NPC Contact (cache name Astral Contact): the cast in
`server/src/main/typescript/elvarg/game/content/combat/magic/LunarSpells.ts`, the contact list and the
contacts in `server/plugins/interface/NpcContact.plugin.js` with `server/plugins/interface/data/npc-contact.json`.

## What live does (rsprox captures)

- **The cast** (rsprox 4045, rev 237, three casts): on the click the caster plays `lunar_human_magic_summon2`
  with `quest_lunar_magic_flax_strim` at height 92 and sound 3618. Seven ticks later the runes (1 astral,
  1 cosmic, 2 air) and the Magic XP (63, Wiki) go, `toplevel_mainmodal_open [-1, -1]` runs and `lunar_contact_npc`
  (interface 75) opens in the main modal. Clicking to walk in between (tick 746) doesn't stop it. Too few runes
  is refused on the click ("You do not have enough Cosmic Runes to cast this spell.", tick 326).
- **The list** is built by the client from the cache's `npc_contact` table (dbtable 130, 23 rows): cs2 1190 and
  2094 lay out the heads and names, and 9733 picks each row's alternate name or head from quest state, for
  example greyed-out locked contacts and Aya for Turael. The server sends nothing to fill it. In rev 242 the
  rows have no named components. Their "Contact" op runs cs2 9732, which sends `if_triggeroplocal` on
  `lunar_contact_npc:scrolllayer` (75:4) with `[contact_id, alt]`; `alt` is 1 only for Amy's contract op
  (cs2 9734).
- **A contact** (4045 tick 716 Watson, 4056 tick 808 Nieve, 1146 Duradel, 1698 Turael/Mazchna/Cyrisus):
  `lunar_contact_lastid` (varbit 5006) becomes the contact_id, the list closes and the NPC's conversation
  opens at once. The Slayer masters open their own Talk-to ("'Ello, and what are you after then?"), not the
  Wiki transcript's astral-contact variant ("'Ello, can I help you?").

## What we do

- Slayer masters (Turael, Mazchna, Vannaka, Chaeldar, Nieve, Duradel, Krystilia, Konar, Spria, Mortimer):
  the NPC's own Talk-to through `npc-dialogue:start`, with no NPC in the world.
- Ours: a second click on the spell before the list has opened is ignored, so one list costs one cast.
- `magic:npc-contact-selected { player, name, contactId, handled }` goes first, so content can answer a
  contact itself. While Guthix Sleeps uses it to recruit Turael, Mazchna, Duradel and Cyrisus.

## Not covered

- Other contacts (Honest Jimmy, Bert, Advisor Ghrim, Dark Mage, Lanthus, Murphy, Cyrisus, Smoggy, Ginea,
  Watson, Barbarian Guard, Amy, Random) have no captured or transcribed contact conversation that works without the NPC in the world.
  They get "You contact <name>." (ours, kept from the old chat menu).
- Ours: the server trusts the client's list. Locked contacts are greyed out by the client and not refused
  again here. Alternate NPCs (Aya, Achtryn, Kuradal, Steve) are not chosen. The spell's right-click
  re-contact (Wiki) and Amy's contract op are not handled.
- The `busy` varbit (12393) the cast toggles is not sent.
- The Wiki astral-contact variants of Honest Jimmy, Murphy and Cyrisus are not used yet. Murphy's and
  Jimmy's branch on conditions nothing answers ("If the player is near Murphy:", "less than 40 cooking"),
  so the first refusal branch always played. Cyrisus's cycles "Dialogue 1..4", which the runner shows
  as a menu. Playing them needs those conditions answered and a cycle step.
