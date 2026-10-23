# Fossil Island underwater

The sea floor north of Fossil Island: Ceto and drift net fishing, Mernia's seaweed patches. Behaviour comes from the [OSRS Wiki](https://oldschool.runescape.wiki/w/Underwater) and the [rsprox capture database](https://rsprox.net/database) (recordings 312, 712, 715, 716).

- **Plugin:** `server/plugins/areas/FossilIslandUnderwater.plugin.js`, data in `server/plugins/areas/data/fossil-island-underwater.json`.
- **Drift nets:** `server/plugins/skills/hunter/DriftNets.Hunter.js` (Hunter README).

## Rowboats

| Boat | Options (captured) |
| --- | --- |
| Museum Camp | Row to the north of the island. / Row out to sea, north of the island. (once found) / Cancel. |
| North of the island | Row to the camp. / Row out to sea. / Cancel. |
| Small island | Row to the north of the island. / Row to the camp. / Dive into the sea. / Cancel. |

- Messages: "You row to the expedition camp...", "You row to the north of the island...", "You row out to sea...". The first trip out to sea adds "Now you have discovered this area, you'll be able to row here directly from the camp!".
- Destinations: camp 3724,3808; north 3733,3893; small island 3765,3899. The captures show 3769,3898 for rowing out to sea, but live OSRS lands on 3765,3899 (checked in-game).
- The screen fades out and the player moves 2 ticks later.
- **Left out:** the barge options ("Row to the barge.", "Row to the barge and travel to the Digsite."). The barge isn't in this map (see `BoneVoyage.Quest.js`).

## Diving

- **Dive** (or "Dive into the sea."): the fade (`fade_overlay`), then a move to 3732,10281 on plane 1. `fossil_underwater` (609) opens on the atmosphere overlay, with `underwater_shallow` (169) in its `water_overlay`, and `fossil_underwater_oxygen` (varbit 5811) is set to 1000.
- **Without diving gear,** the player says "Hmm, it would be easier if I had some method of breathing under water." first. Then comes "Dive without diving gear?" with:
  - "Yes, dive anyway."
  - "Yes, dive anyway, and don't ask this again.", which adds "Speak to Mairin if you ever want to re-enable the warning."
  - "No." This option wasn't captured.
- **Swimming:** while underwater the player's stance and movement are `human_real_swimming_ready` (3418) and `human_real_swimming` (3415).
- **Anchor rope:** Climb plays `100_pirate_bubbles_spotanim` and moves the player to 3769,3898 after 2 ticks, with no fade.

## Oxygen (Wiki)

- **Drain:** 1% every 3 ticks.
- **Kept full by:** a fishbowl helmet with a diving apparatus, or the Medallion of the Deep.
- **At 0%:** the player drowns, taking no damage. They lose 10-20 of the mermaid's tears they carry and wake on the small island. The drowning message is ours; nothing captured it.
- **Not done yet:** air bubbles and pufferfish refilling oxygen, and the "Your hands are full." swim prompt.

## Drift net area

- **Ceto** plays her [Wiki transcript](https://oldschool.runescape.wiki/w/Transcript:Ceto) from `npc-dialogues.json`. That covers Talk-to, her Pay option, and the tunnel's Enter and Pay, each its own section. `Ceto.Hunter.js` answers the transcript's conditions (levels, access, numulites) and runs its actions: 200 numulites for the day, 20,000 on "Thanks - no more entry fees for you!", and entering the instance.
- **The tunnel** is a multiloc (30958) on `fossil_driftnet_unlimitedaccess` (varbit 242). Its Pay option goes once access is permanent.
- **Annette** (`Annette.Hunter.js`) plays her transcript and opens "Annette's Nets" (`fossil_driftnet_store` 309 with `fossil_driftnet_sidestore` 307). The cache scripts draw the stored count from varbit 243 and set the ops: Withdraw-1/5/X/All and Banknote-All, Store-1/5/X/All. She holds up to 2,000 nets, noted or not.
- **Not done yet:** the harvest interface `fossil_driftnet` (607). Its Take all, Bank all and Discard all buttons and confirmations are client-side, but no capture shows how the fish are sent to it, so harvesting still uses a chat menu.
- Each player gets their own instance, as the Wiki describes. The player lands inside by the plant door (3737,10299), and the plant door leads back out beside the tunnel (3729,10294). Neither tile is captured.
