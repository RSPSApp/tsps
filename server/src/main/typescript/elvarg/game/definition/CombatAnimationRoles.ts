// The combat role an animation's gameval name gives it. Shared by NpcDefinitionLoader and
// scripts/mine-npc-combat-sounds.mjs, which imports this file directly (Node strips the types), so it
// must stay free of imports and of TypeScript-only runtime syntax (enums, namespaces, `import =`).

export type CombatAnimationRole = "attack" | "block" | "death";

const DEATH_WORDS = new Set(["death", "die", "dies", "dying", "dead"]);
const BLOCK_WORDS = new Set(["block", "blocking", "defend", "defending", "defence", "defense", "def", "parry"]);
const ATTACK_WORDS = new Set([
    "attack", "att", "slash", "stab", "crush", "lunge", "pound", "swipe", "smash", "slam", "bite",
    "claw", "sting", "peck", "scratch", "whip", "headbutt", "shoot", "throw", "spit", "spell",
]);
/** Combat style words: an attack, unless the name also stands or moves (`top_spider_ranged_idle`). */
const STYLE_WORDS = new Set(["melee", "ranged", "range", "magic", "mage"]);
export const MOTION_WORDS = new Set(["idle", "ready", "walk", "run", "stand", "standing"]);
/** An observed entrance or movement is not evidence for an otherwise missing combat role. */
export const NON_COMBAT_WORDS = new Set([...MOTION_WORDS, "tele", "teleport", "appear", "disappear", "spawn"]);

export const animationWords = (name: string) => name.split("_").map((word) => word.replace(/\d+$/, "")).filter(Boolean);

/**
 * The combat role an animation's gameval name gives it (`snake_death`, `specter_parry`,
 * `human_unarmedpunch`), or null when the name does not say. Death and block words win over
 * attack words, so `npc_x_melee_death` is a death.
 */
export function animationRoleByName(name: string | null): CombatAnimationRole | null {
    if (!name) return null;
    const words = animationWords(name);
    if (words.some((word) => DEATH_WORDS.has(word) || word.startsWith("death") || word.endsWith("death"))) return "death";
    if (words.some((word) => BLOCK_WORDS.has(word) || /(block|parry|defend)$/.test(word))) return "block";
    if (words.some((word) => ATTACK_WORDS.has(word) || /attack|punch|kick|strike/.test(word) || word.startsWith("cast"))) {
        return "attack";
    }
    if (words.some((word) => STYLE_WORDS.has(word)) && !words.some((word) => MOTION_WORDS.has(word))) return "attack";
    return null;
}
