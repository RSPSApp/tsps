import { inject } from "@runelite/client/plugins/PluginInjector";
import { AnimationSmoothingConfig } from "./AnimationSmoothingConfig";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";

import { EXCLUDED_NPC_IDLES, EXCLUDED_SEQUENCES } from "./exclusions";

/**
 * Animation smoothing, as in RuneLite: keyframe animations of players, NPCs, graphics and
 * scenery are blended toward their next frame by how far into the current frame they are,
 * instead of jumping from frame to frame. The renderers ask smoothsPlayer/smoothsNpc per
 * animation; scenery is baked a frame per client cycle when its map square loads
 * (smoothsObjects), skipping EXCLUDED_SEQUENCES there.
 */
export class AnimationSmoothingPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Animation Smoothing",
        description: "Blends player, NPC, graphic and object animations between their frames.",
        tags: ["animation"],
        enabledByDefault: false,
        configKey: "animationsmoothingplugin",
    };

    static config = AnimationSmoothingConfig;
    private readonly config = inject(AnimationSmoothingConfig);

    objectSettings(): { smoothLocAnimations: boolean; smoothLocAnimationSteps: number } {
        const quality = this.config.sceneryQuality();
        return {
            smoothLocAnimations: this.smoothsObjects(),
            smoothLocAnimationSteps: quality === 0 || quality === 8 ? quality : 4,
        };
    }

    /** Whether a player's animation (action or movement) is blended. */
    smoothsPlayer(seqId: number): boolean {
        return this.isEnabled() && this.config.players() && !EXCLUDED_SEQUENCES.has(seqId);
    }

    /** Whether graphics (spotanims on actors and the ground, and projectiles) are blended. */
    smoothsGraphics(): boolean {
        return this.isEnabled() && this.config.graphics();
    }

    /** Whether scenery animations are baked blended (read when a map square is built). */
    smoothsObjects(): boolean {
        return this.isEnabled() && this.config.objects();
    }

    /** Whether any NPC animation is blended; a cheap check before the per-sequence one. */
    smoothsNpcs(): boolean {
        return this.isEnabled() && this.config.npcs();
    }

    /** Whether an NPC's animation is blended; `action` is false for its movement/idle pose. */
    smoothsNpc(npcTypeId: number, seqId: number, action: boolean): boolean {
        if (!this.isEnabled() || !this.config.npcs() || EXCLUDED_SEQUENCES.has(seqId)) return false;
        return action || !EXCLUDED_NPC_IDLES.has(npcTypeId);
    }
}
