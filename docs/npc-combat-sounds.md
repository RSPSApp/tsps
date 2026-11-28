# NPC combat sounds

An NPC makes three sounds in a fight. Live sends each as a **private synth** (a plain `SynthSound` packet, no position) to the player in the fight, in the tick of the event:

| Event | Who hears it | Hook |
| --- | --- | --- |
| The NPC takes a hit | the player who hit it | `CombatFactory`, after the hit resolves |
| The NPC starts an attack | the player it attacks | `Combat`, right after the combat method's `start` |
| The NPC dies | every player who damaged it | `NPCDeathTask` |

`NpcCombatSounds` (`server/src/main/typescript/elvarg/game/definition/NpcCombatSounds.ts`) plays them from `server/data/definitions/npc-combat-sounds.json`: `npcs[id]` has `hit`, `attack` and `death`, each a list of `[sound, delay]`; one is picked at random per event. A death sound in the definition itself (`npc-combat-defs.json` `sounds.death`) wins over the captured one.

The NPC attack and death sounds used to go out as area sounds of range 0, which the client drops, so they were silent; they now reach the player.

## Where the data comes from

The packet names no NPC, so `server/scripts/mine-npc-combat-sounds.mjs` ties a sound to an NPC id by how reliably it shows up in that NPC's ticks in the rsprox captures. The header of the script has the exact rules and the commands to rebuild the file. It reads either the text RSProx's own decoder (`net.rsprox.proxy.cli.BinaryToStringCommandKt`) writes for a `.bin` recording, or the transcripts RSProx's `TranscribeCommandKt` writes (the `rsprox_transcripts/<rev>/<rec>.txt` files of the osrs-captures index), and with `--out` it refuses to overwrite the table (exit 1) when the input is in neither format. The table is built from the transcripts of every recording in that index: the public rsprox.net ones and the local imports (revisions 223 to 243, 6,589 recordings). In short:

- a tick is a "hit" tick for an NPC that took a hitsplat and played no attack animation, an "attack" tick when it played an attack animation and took no hitsplat, a "death" tick when it played its death animation. An animation whose gameval name says attack or death is classed by it, with the rule `NpcDefinitionLoader` uses (`CombatAnimationRoles.ts`: `dark_beast_update_attack` is an attack, `dark_beast_update_death` a death); otherwise `npc-captured-animations.json` classes it, so a name that only says block doesn't overrule a captured death (`scarab_parry` is the scarab swarm's death);
- in the transcripts only the recording player's own fight counts, since the synths go to the player in the fight: a hitsplat of another player's type (13, 17, 19, 21, 23, 25, 54, 66, the "other" half of each hitsplat pair) makes no hit tick, and an NPC whose last hitsplat was one dies as their kill, not a death tick;
- a sound is kept for an NPC when it is in at least 60% of that NPC's ticks of the kind, at least 8 times;
- a sound is NPC-specific only if the NPCs it was kept for account for at least 30% of every tick it was sent in, which drops weapon swings, armour and voices that ride along. Here every tick the NPC attacked (or was hit) counts, also one that mixed both: a dark beast's attack sound mostly plays in the tick the player's hit lands on it;
- a sound the server already plays elsewhere is left out, so nothing is sent twice. That is any number in the code of a statement naming a sound in `src/` and `plugins/` (and under a `sound` key in plugin JSON); digits in comments and string literals don't count, so a capture note or a line of dialogue beside the word "sound" hides nothing. The quest plugins don't count either: their scenes play sounds for scripted actors (a Watchtower cutscene's dragon hit 410), not through the combat hooks, and would otherwise silence every NPC that shares the sound. A boss plugin's sound that it plays for some NPCs only is listed in the script's `SCOPED_SOUNDS` and left out for those alone: the Araxxor Mirrorback's hit 4020 (Nylocas and the other araxytes keep it), Vorkath's ranged landing 3403 (Jal-Ak keeps its attack), Zulrah's cloud fading 795/796 (tied to no NPC event).

The dark beast (4005) shows all three (rsprox captures local 1000730, local 1001309): 391 in its defend animation's tick, 389 in its attack animation's tick, 390 in its death animation's tick, each with delay 0.

## Not covered

Bosses that script their own sounds keep doing so. The player's own weapon-swing and armour/shield hit sounds are not here: they depend on the worn item, and per-item association in the captures is confounded by whole sets being worn together.
