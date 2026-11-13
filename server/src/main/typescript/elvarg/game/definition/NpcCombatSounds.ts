import fs = require("fs");
import path = require("path");

import type { NPC } from "../entity/impl/npc/NPC";
import type { Player } from "../entity/impl/player/Player";
import { Sound } from "../Sound";
import { Sounds } from "../Sounds";

/** A sound and its delay in client ticks (20 ms each). */
type SoundEntry = readonly [sound: number, delay: number];

interface NpcSounds {
    hit?: SoundEntry[];
    attack?: SoundEntry[];
    death?: SoundEntry[];
}

const FILE = "data/definitions/npc-combat-sounds.json";

/**
 * The sounds an NPC makes in a fight, from data/definitions/npc-combat-sounds.json (rsprox captures,
 * scripts/mine-npc-combat-sounds.mjs). Live sends them as private synths to the player in the fight,
 * in the tick of the event: the NPC taking a hit, starting an attack, or dying. A positioned sound of
 * range 0 is dropped by the client, so none of these go out as area sounds.
 */
export class NpcCombatSounds {
    private static data: Record<string, NpcSounds> | null = null;

    /** The player hits `npc`: they hear its hit sound. */
    public static hit(npc: NPC, attacker: Player): void {
        NpcCombatSounds.play(attacker, NpcCombatSounds.pick(npc, "hit"));
    }

    /** `npc` starts an attack: the player it targets hears the attack sound. */
    public static attack(npc: NPC, target: Player): void {
        NpcCombatSounds.play(target, NpcCombatSounds.pick(npc, "attack"));
    }

    /**
     * `npc` dies: every player who fought it hears its death sound, the definition's own
     * (npc-combat-defs.json `sounds.death`) before the captured one.
     */
    public static death(npc: NPC, listeners: Iterable<Player>): void {
        const own = npc.getCurrentDefinition().getDeathSound();
        const entry: SoundEntry | undefined = own > 0 ? [own, 0] : NpcCombatSounds.pick(npc, "death");
        if (!entry) return;
        for (const listener of listeners) NpcCombatSounds.play(listener, entry);
    }

    private static pick(npc: NPC, kind: keyof NpcSounds): SoundEntry | undefined {
        const entries = NpcCombatSounds.load()[npc.getCurrentDefinition().getId()]?.[kind];
        if (!entries?.length) return undefined;
        return entries[entries.length === 1 ? 0 : Math.floor(Math.random() * entries.length)];
    }

    private static play(player: Player, entry: SoundEntry | undefined): void {
        if (!entry || !player?.isRegistered?.()) return;
        Sounds.sendSound(player, new Sound(entry[0], 1, entry[1], 0));
    }

    private static load(): Record<string, NpcSounds> {
        NpcCombatSounds.data ??= (JSON.parse(fs.readFileSync(path.resolve(FILE), "utf8")) as { npcs: Record<string, NpcSounds> }).npcs;
        return NpcCombatSounds.data;
    }
}
