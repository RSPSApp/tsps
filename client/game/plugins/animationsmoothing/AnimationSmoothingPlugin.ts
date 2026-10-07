import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";

/** Player poses that break when blended. */
const EXCLUDED_PLAYER_SEQUENCES = new Set([244]);
/** NPC animations that break when blended (hellhound defence and others). */
const EXCLUDED_NPC_SEQUENCES = new Set([6566, 8270, 8271, 5583]);
/** NPCs whose idle poses break when blended: the wyrm and the tree spirits. */
const EXCLUDED_NPC_IDLES = new Set([8610, 1163, 6380, 6319]);

/**
 * Animation smoothing, as in RuneLite: keyframe animations of players and NPCs are blended
 * toward their next frame by how far into the current frame they are, instead of jumping from
 * frame to frame. The renderers ask smoothsPlayer/smoothsNpc per animation.
 */
export class AnimationSmoothingPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Animation Smoothing",
        description: "Blends player, NPC and graphic animations between their frames.",
        tags: ["animation"],
        enabledByDefault: false,
        configKey: "animationsmoothingplugin",
    };

    /** Whether a player's animation (action or movement) is blended. */
    smoothsPlayer(seqId: number): boolean {
        return this.isEnabled() && !EXCLUDED_PLAYER_SEQUENCES.has(seqId);
    }

    /** Whether graphics (spotanims on actors and the ground, and projectiles) are blended. */
    smoothsGraphics(): boolean {
        return this.isEnabled();
    }

    /** Whether an NPC's animation is blended; `action` is false for its movement/idle pose. */
    smoothsNpc(npcTypeId: number, seqId: number, action: boolean): boolean {
        if (!this.isEnabled() || EXCLUDED_NPC_SEQUENCES.has(seqId)) return false;
        return action || !EXCLUDED_NPC_IDLES.has(npcTypeId);
    }
}
