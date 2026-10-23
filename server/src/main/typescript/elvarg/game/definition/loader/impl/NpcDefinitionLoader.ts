import fs = require("fs");
import path = require("path");
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { GameConstants } from "../../../GameConstants";
import { NpcDefinition } from "../../NpcDefinition";
import { DefinitionLoader } from "../DefinitionLoader";
import { CombatType } from "../../../content/combat/CombatType";

type CombatStats = {
    name?: string;
    examine?: string;
    hitpoints?: number;
    attackLevel?: number;
    strengthLevel?: number;
    defenceLevel?: number;
    rangedLevel?: number;
    magicLevel?: number;
    attackSpeed?: number;
    maxHit?: number;
    aggressive?: boolean;
    poisonous?: boolean;
    venomous?: boolean;
    demon?: boolean;
    attributes?: string[];
    members?: boolean;
    attackType?: CombatType;
    slayerLevel?: number;
    attackBonuses?: {
        melee?: number;
        magic?: number;
        ranged?: number;
    };
    defenceBonuses?: {
        stab?: number;
        slash?: number;
        crush?: number;
        magic?: number;
        ranged?: number;
        light?: number;
        heavy?: number;
    };
};

type CombatAnimation = {
    anims?: { spawn?: number | null; attack?: number; block?: number; death?: number };
    sounds?: { death?: number };
    projectile?: number;
    /** Ticks from the death animation to the death itself; 2 when absent. */
    deathTicks?: number;
    /** Ticks from removal to respawn; 25 when absent, 0 to disable. */
    respawn?: number;
};

type CombatAnimationRole = "attack" | "block" | "death";

const DEATH_WORDS = new Set(["death", "die", "dies", "dying", "dead"]);
const BLOCK_WORDS = new Set(["block", "blocking", "defend", "defending", "defence", "defense", "def", "parry"]);
const ATTACK_WORDS = new Set([
    "attack", "att", "slash", "stab", "crush", "lunge", "pound", "swipe", "smash", "slam", "bite",
    "claw", "sting", "peck", "scratch", "whip", "headbutt", "shoot", "throw", "spit", "spell",
]);
/** Combat style words: an attack, unless the name also stands or moves (`top_spider_ranged_idle`). */
const STYLE_WORDS = new Set(["melee", "ranged", "range", "magic", "mage"]);
const MOTION_WORDS = new Set(["idle", "ready", "walk", "run", "stand", "standing"]);

const animationWords = (name: string) => name.split("_").map((word) => word.replace(/\d+$/, "")).filter(Boolean);

/**
 * The combat role an animation's gameval name gives it (`snake_death`, `specter_parry`,
 * `human_unarmedpunch`), or null when the name does not say. Death and block words win over
 * attack words, so `npc_x_melee_death` is a death.
 */
function animationRoleByName(name: string | null): CombatAnimationRole | null {
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

/** Words that make an animation a poor default for its role (`dragon_attack_special`). */
const VARIANT_WORDS = new Set(["special", "spec", "cutscene", "loop", "reverse", "fake", "quick", "fast", "transition"]);
/** Family names too broad to pick from: every human NPC shares `human_ready`, and the defaults are human. */
const BROAD_FAMILIES = new Set(["human"]);

let animationFamilies: Map<string, { id: number; words: string[]; role: CombatAnimationRole }[]> | null = null;

/**
 * Each role's animation for an NPC that nothing else covers, from the family its stand animation
 * names: `npc_kraken01_idle01` gives `npc_kraken01_melee01` and `npc_kraken01_death01`,
 * `zombie_update_ready_weapon` gives `zombie_update_attack_weapon`. A role takes the family
 * animation with the fewest extra words, so a weapon or phase variant may differ from live; an
 * animation of the right creature still beats the human default.
 */
function familyRoles(standAnimation: number): NonNullable<CombatAnimation["anims"]> {
    const standName = standAnimation >= 0 ? CacheDefinitions.getSeqName(standAnimation) : null;
    if (!standName) return {};
    const family = animationWords(standName).filter((word) => !MOTION_WORDS.has(word) && !/^(ready|idle)/.test(word));
    if (family.length === 0 || (family.length === 1 && BROAD_FAMILIES.has(family[0]))) return {};
    if (!animationFamilies) {
        animationFamilies = new Map();
        for (const [id, name] of CacheDefinitions.getSeqNames()) {
            const role = animationRoleByName(name);
            if (!role) continue;
            const words = animationWords(name);
            const members = animationFamilies.get(words[0]) ?? [];
            members.push({ id, words, role });
            animationFamilies.set(words[0], members);
        }
    }
    const best: Partial<Record<CombatAnimationRole, { id: number; extra: number }>> = {};
    for (const { id, words, role } of animationFamilies.get(family[0]) ?? []) {
        if (!family.every((word) => words.includes(word))) continue;
        const extra = words.length - family.length + (words.some((word) => VARIANT_WORDS.has(word)) ? 3 : 0);
        const current = best[role];
        if (!current || extra < current.extra || (extra === current.extra && id < current.id)) best[role] = { id, extra };
    }
    const roles: NonNullable<CombatAnimation["anims"]> = {};
    for (const role of ["attack", "block", "death"] as const) {
        if (best[role] && best[role]!.extra <= 2) roles[role] = best[role]!.id;
    }
    return roles;
}

/**
 * An NPC's fights in live captures: `hits` is [hits taken, hits with no animation of its own],
 * `seen` is animation id -> sightings as [death, block, attack, other] by hit timing.
 */
type CapturedAnimations = {
    hits?: [number, number];
    seen?: Record<string, [number, number, number, number]>;
};

/**
 * Hits an NPC must take in captures before it counts as having no block animation, when at least
 * half of them show no animation (an NPC that blocks leaves under a third unanswered).
 */
const CAPTURED_NO_BLOCK_HITS = 10;

/**
 * Each role's animation from an NPC's captures. Hit timing cannot tell an attack from a block
 * (an NPC trading hits attacks the tick before the player's hitsplat too), so the name gives the
 * role and the captures say which of the NPC's animations it really plays. Timing alone decides
 * only the clear cases: a death (health bar emptied, then removed) and an animation seen almost
 * only on hits (the abyssal demon's blink). An NPC hit often that mostly does not animate has no block.
 */
function capturedRoles(entry: CapturedAnimations): NonNullable<CombatAnimation["anims"]> {
    const best: Partial<Record<CombatAnimationRole, { id: number; count: number }>> = {};
    for (const [key, [death, block, attack]] of Object.entries(entry.seen ?? {})) {
        const id = Number(key);
        const role = animationRoleByName(CacheDefinitions.getSeqName(id))
            ?? (death >= 2 && death >= block + attack ? "death"
                : block >= 5 && block >= 9 * (attack + death) ? "block" : null);
        if (!role) continue;
        const count = role === "death" ? death : block + attack;
        if ((best[role]?.count ?? -1) < count) best[role] = { id, count };
    }
    const roles: NonNullable<CombatAnimation["anims"]> = {};
    for (const role of ["attack", "block", "death"] as const) {
        if (best[role]) roles[role] = best[role]!.id;
    }
    const [hits = 0, unanswered = 0] = entry.hits ?? [];
    if (roles.block === undefined && hits >= CAPTURED_NO_BLOCK_HITS && unanswered >= hits / 2) roles.block = -1;
    return roles;
}

const normalizeName = (value?: string) => (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Dump attack_type tokens that mean "this thing can hit you in melee". */
const MELEE_ATTACK_TYPES = new Set(["stab", "slash", "crush", "melee"]);

export class NpcDefinitionLoader extends DefinitionLoader {
    /**
     * Translates one osrsreboxed monsters-complete.json entry into the internal
     * stats shape. Undefined (rather than 0) is used wherever the dump has no
     * usable value, so the `?? existing` fallbacks below leave the definition's
     * own default alone.
     */
    public static fromMonsterDump(monster: any): CombatStats {
        return {
            name: monster.name,
            // The cache has no NPC examine text (OSRS sends it from the server),
            // so the dump is the only source for it.
            examine: typeof monster.examine === "string" ? monster.examine : undefined,
            hitpoints: monster.hitpoints,
            attackLevel: monster.attack_level,
            strengthLevel: monster.strength_level,
            defenceLevel: monster.defence_level,
            magicLevel: monster.magic_level,
            rangedLevel: monster.ranged_level,
            attackSpeed: monster.attack_speed,
            // null on ~141 entries of the dump.
            maxHit: typeof monster.max_hit === "number" ? monster.max_hit : undefined,
            aggressive: monster.aggressive === true,
            poisonous: monster.poisonous === true,
            venomous: monster.venomous === true,
            demon: Array.isArray(monster.attributes) && monster.attributes.includes("demon"),
            attributes: Array.isArray(monster.attributes) ? monster.attributes.map(String) : undefined,
            members: monster.members === true,
            attackType: NpcDefinitionLoader.resolveAttackType(monster.attack_type),
            slayerLevel:
                monster.slayer_monster === true && monster.slayer_level > 0
                    ? monster.slayer_level
                    : undefined,
            attackBonuses: {
                // Accuracy only - damage comes from maxHit, so the dump's
                // strength/magic/ranged damage bonuses are deliberately unread.
                melee: monster.attack_bonus,
                magic: monster.attack_magic,
                ranged: monster.attack_ranged,
            },
            defenceBonuses: {
                stab: monster.defence_stab,
                slash: monster.defence_slash,
                crush: monster.defence_crush,
                magic: monster.defence_magic,
                ranged: monster.defence_ranged_standard,
                light: monster.defence_ranged_light,
                heavy: monster.defence_ranged_heavy,
            },
        };
    }

    /**
     * Picks the single default combat style for an NPC from the dump's attack_type
     * list. An NPC gets one CombatMethod, so hybrids have to pick a side: anything
     * that can melee keeps meleeing, because standing a hybrid off at range would
     * break it more thoroughly than walking a pure ranger into melee ever did.
     * Only pure ranged/magic monsters switch. `dragonfire` and `typeless` are not
     * styles this engine models, so they fall through to melee.
     */
    public static resolveAttackType(attackTypes: unknown): CombatType {
        const types = Array.isArray(attackTypes)
            ? attackTypes.map((type) => String(type).toLowerCase())
            : [];
        if (types.some((type) => MELEE_ATTACK_TYPES.has(type))) return CombatType.MELEE;
        if (types.includes("ranged")) return CombatType.RANGED;
        if (types.includes("magic")) return CombatType.MAGIC;
        return CombatType.MELEE;
    }

    load(): boolean {
        NpcDefinition.definitions.clear();
        const directory = path.resolve(GameConstants.DEFINITIONS_DIRECTORY);
        // Combat stats, including aggression, come straight from the vendored dump.
        // Animations are not in it and keep coming from the files below.
        const monsters = this.readOptional(directory, "monsters-complete.json") ?? {};
        const animationFile = this.read(directory, "npc-combat-defs.json");
        const observedAnimations = this.read(directory, "npc-animations.json") as Record<string, number[]>;
        const animations: Record<string, CombatAnimation> = {};

        for (const row of animationFile.refs?.npcs ?? []) {
            const [id, attack, block, death] = row;
            animations[String(id)] = { anims: { attack, block, death } };
        }
        const projectiles: Record<string, number> = {};
        for (const [id, entry] of Object.entries((animationFile.npcs ?? {}) as Record<string, CombatAnimation>)) {
            if (entry?.anims) animations[id] = entry;
            if (Number.isInteger(entry?.projectile)) projectiles[id] = entry.projectile as number;
        }
        // Only hand-made entries stop the guess below; captures leave a role open when they do not settle it.
        const configuredAnimationIds = new Set(Object.keys(animations));
        // Animations seen in live captures fill what a hand-made entry leaves out.
        const captured = this.readOptional(directory, "npc-captured-animations.json")?.npcs ?? {};
        let capturedAnimations = 0;
        for (const [id, entry] of Object.entries(captured as Record<string, CapturedAnimations>)) {
            const roles = capturedRoles(entry ?? {});
            capturedAnimations += Object.keys(roles).length;
            if (Object.keys(roles).length === 0) continue;
            animations[id] = { ...animations[id], anims: { ...roles, ...animations[id]?.anims } };
        }

        const roleByAnimation = new Map<number, CombatAnimationRole>();
        for (const animation of Object.values(animations)) {
            for (const role of ["attack", "block", "death"] as const) {
                const id = animation.anims?.[role];
                if (Number.isInteger(id)) roleByAnimation.set(id!, role);
            }
        }
        let inferredAnimations = 0;
        let namedAnimations = 0;
        let guessedAnimations = 0;
        for (const [npcId, observed] of Object.entries(observedAnimations)) {
            if (!Array.isArray(observed) || observed.length === 0) continue;
            // An observed list has no order to trust: a role comes from the same animation's role
            // in a configured or captured entry, then from the animation's cache name, and only
            // then by guess.
            const inferred: NonNullable<CombatAnimation["anims"]> = {};
            for (const animationId of observed) {
                const role = roleByAnimation.get(animationId);
                if (role && inferred[role] === undefined) inferred[role] = animationId;
            }
            const namedRoles = new Map<number, CombatAnimationRole>();
            for (const animationId of observed) {
                const role = animationRoleByName(CacheDefinitions.getSeqName(animationId));
                if (role) namedRoles.set(animationId, role);
            }
            const inferredUsed = new Set(Object.values(inferred));
            for (const [animationId, role] of namedRoles) {
                if (inferred[role] !== undefined || inferredUsed.has(animationId)) continue;
                inferred[role] = animationId;
                inferredUsed.add(animationId);
                namedAnimations++;
            }
            const explicit = animations[npcId]?.anims ?? {};
            const resolved = { ...inferred, ...explicit };
            inferredAnimations += Object.keys(inferred).length;
            if (!configuredAnimationIds.has(npcId)) {
                // A named animation never fills another role: a death is not guessed as an attack.
                const ids = Array.from(new Set(observed.filter((id) => Number.isInteger(id) && id >= 0 && !namedRoles.has(id))));
                const indexes = ids.map((_, index) => index);
                const preferences: Record<CombatAnimationRole, number[]> = {
                    attack: ids.length <= 2 ? indexes : [1, ...indexes.filter((index) => index !== 1)],
                    block: indexes,
                    death: ids.length >= 3 ? [...indexes].reverse() : [],
                };
                const used = new Set(Object.values(resolved));
                for (const role of ["attack", "block", "death"] as const) {
                    if (resolved[role] !== undefined) continue;
                    const guess = preferences[role].map((index) => ids[index]).find((id) => !used.has(id));
                    if (guess === undefined) continue;
                    resolved[role] = guess;
                    used.add(guess);
                    guessedAnimations++;
                }
            }
            if (Object.keys(resolved).length > 0) animations[npcId] = { ...animations[npcId], anims: resolved };
        }

        // Last, an attackable NPC's roles that nothing above covers come from its stand animation's family.
        let familyAnimations = 0;
        const npcCount = CacheDefinitions.getCounts().npcs;
        for (let id = 0; id < npcCount; id++) {
            const cached = CacheDefinitions.getNpc(id);
            if (!cached?.actions?.some((action) => action === "Attack")) continue;
            const current = animations[id]?.anims ?? {};
            if (current.attack !== undefined && current.block !== undefined && current.death !== undefined) continue;
            const family = familyRoles(cached.idleSeqId);
            const filled = { ...family, ...current };
            familyAnimations += Object.keys(filled).length - Object.keys(current).length;
            if (Object.keys(filled).length > Object.keys(current).length) {
                animations[id] = { ...animations[id], anims: filled };
            }
        }

        const ids = new Set([
            ...Object.keys(monsters),
            ...Object.keys(animationFile.npcs ?? {}),
            ...Object.keys(animations), ...Object.keys(observedAnimations),
            ...Object.keys(projectiles),
        ]);
        let applied = 0;
        let mismatched = 0;
        const count = CacheDefinitions.getCounts().npcs;
        for (const key of ids) {
            const id = Number(key);
            if (!Number.isInteger(id) || id < 0 || id >= count) continue;
            const cached = CacheDefinitions.getNpc(id);
            const definition = NpcDefinition.forId(id) as any;
            const stat = monsters[key]
                ? NpcDefinitionLoader.fromMonsterDump(monsters[key])
                : undefined;
            // Name-guarded: a dump keyed to a different cache revision is dropped,
            // not applied to whatever monster happens to sit at that id here.
            if (stat && normalizeName(stat.name) === normalizeName(cached.name)) {
                const levels = definition.getStats().slice();
                for (const [index, value] of [
                    [0, stat.attackLevel], [1, stat.strengthLevel], [2, stat.defenceLevel],
                    [3, stat.rangedLevel], [4, stat.magicLevel],
                    [5, stat.attackBonuses?.melee], [7, stat.attackBonuses?.magic],
                    [9, stat.attackBonuses?.ranged],
                    [10, stat.defenceBonuses?.stab], [11, stat.defenceBonuses?.slash],
                    [12, stat.defenceBonuses?.crush], [13, stat.defenceBonuses?.magic],
                    [14, stat.defenceBonuses?.ranged],
                ]) {
                    if (Number.isFinite(value)) levels[index] = Math.trunc(value as number);
                }
                Object.assign(definition, {
                    stats: levels,
                    rangedDefenceBonuses: { light: stat.defenceBonuses?.light, heavy: stat.defenceBonuses?.heavy },
                    // getExamine() falls back to a generic line, so keep the raw field here.
                    examine: stat.examine ?? definition.examine,
                    hitpoints: stat.hitpoints ?? definition.getHitpoints(),
                    attackSpeed: stat.attackSpeed ?? definition.getAttackSpeed(),
                    maxHit: stat.maxHit ?? definition.getMaxHit(),
                    aggressive: stat.aggressive ?? definition.isAggressive(),
                    poisonous: stat.poisonous ?? definition.isPoisonous(),
                    venomous: stat.venomous ?? definition.isVenomous(),
                    demon: stat.demon ?? definition.isDemon(),
                    attributes: stat.attributes ?? definition.getAttributes(),
                    members: stat.members ?? definition.isMembers(),
                    attackType: stat.attackType ?? definition.getAttackType(),
                    slayerLevel: stat.slayerLevel ?? definition.getSlayerLevel(),
                });
                applied++;
            } else if (stat) {
                mismatched++;
            }

            if (Number.isInteger(projectiles[key])) {
                definition.projectileId = projectiles[key];
            }

            const respawn = animationFile.npcs?.[key]?.respawn;
            if (Number.isInteger(respawn) && respawn >= 0) definition.setRespawn(respawn);

            const animation = animations[key];
            if (animation) {
                Object.assign(definition, {
                    attackAnim: animation.anims?.attack ?? definition.getAttackAnim(),
                    defenceAnim: animation.anims?.block ?? definition.getDefenceAnim(),
                    deathAnim: animation.anims?.death ?? definition.getDeathAnim(),
                    spawnAnim: animation.anims?.spawn ?? definition.getSpawnAnim(),
                    deathSound: animation.sounds?.death ?? definition.getDeathSound(),
                    deathTicks: Number.isInteger(animation.deathTicks) ? animation.deathTicks : definition.getDeathTicks(),
                });
            }
        }
        (mismatched > 0 ? console.warn : console.debug)(
            `[npc-definitions] cache-backed; configured stats applied=${applied}, mismatched=${mismatched}, ` +
            `service animations captured=${capturedAnimations}, inferred=${inferredAnimations} (by name=${namedAnimations}), guessed=${guessedAnimations}, by family=${familyAnimations}`
        );
        return true;
    }

    file(): string {
        return GameConstants.DEFINITIONS_DIRECTORY;
    }

    private read(directory: string, name: string): any {
        return JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    }

    /** The monster dump is a large vendored file; boot without it rather than crash. */
    private readOptional(directory: string, name: string): any {
        const file = path.join(directory, name);
        if (!fs.existsSync(file)) {
            console.warn(`[npc-definitions] ${name} missing - NPC combat stats will fall back to defaults`);
            return null;
        }
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }
}
