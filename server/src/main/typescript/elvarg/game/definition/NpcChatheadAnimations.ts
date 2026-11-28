import fs = require("fs");
import path = require("path");

const FILE = "data/definitions/npc-captured-chatheads.json";

/** The ids the human chathead animations lie in, DialogueExpression's among them. */
const FIRST_HUMAN_ANIMATION = 554;
const LAST_HUMAN_ANIMATION = 617;

/**
 * Heads with a rig of their own, from data/definitions/npc-captured-chatheads.json (rsprox captures).
 * A human chathead animation barely moves them, so live sends these instead.
 */
export class NpcChatheadAnimations {
    private static data: Record<string, { seq: number }> | null = null;

    /** The animation to send for `npcId`'s head on a line asking for `requested`. */
    public static forLine(npcId: number, requested: number): number {
        // An animation outside the human ones was picked for this head: keep it.
        if (requested < FIRST_HUMAN_ANIMATION || requested > LAST_HUMAN_ANIMATION) return requested;
        NpcChatheadAnimations.data ??= (JSON.parse(fs.readFileSync(path.resolve(FILE), "utf8")) as { npcs: Record<string, { seq: number }> }).npcs;
        return NpcChatheadAnimations.data[npcId]?.seq ?? requested;
    }
}
