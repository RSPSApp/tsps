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
    };
};

type CombatAnimation = {
    anims?: { spawn?: number | null; attack?: number; block?: number; death?: number };
    sounds?: { death?: number };
    projectile?: number;
};

type CombatAnimationRole = "attack" | "block" | "death";

const ANIMATION_FALLBACKS: Record<number, CombatAnimation> = {
    7: { anims: { attack: 6184, block: 6188, death: 6182 } },
    15: { anims: { attack: 390, block: 391, death: 392 } },
};

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
                // The dump splits ranged defence into light/standard/heavy; this
                // engine models a single ranged defence.
                ranged: monster.defence_ranged_standard,
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
        for (const [id, fallback] of Object.entries(ANIMATION_FALLBACKS)) {
            if (!animations[id]) animations[id] = fallback;
        }
        const configuredAnimationIds = new Set(Object.keys(animations));

        const roleByAnimation = new Map<number, CombatAnimationRole>();
        for (const animation of Object.values(animations)) {
            for (const role of ["attack", "block", "death"] as const) {
                const id = animation.anims?.[role];
                if (Number.isInteger(id)) roleByAnimation.set(id!, role);
            }
        }
        let inferredAnimations = 0;
        let guessedAnimations = 0;
        for (const [npcId, observed] of Object.entries(observedAnimations)) {
            if (!Array.isArray(observed) || observed.length === 0) continue;
            const inferred: NonNullable<CombatAnimation["anims"]> = {};
            for (const animationId of observed) {
                const role = roleByAnimation.get(animationId);
                if (role && inferred[role] === undefined) inferred[role] = animationId;
            }
            const explicit = animations[npcId]?.anims ?? {};
            const resolved = { ...inferred, ...explicit };
            inferredAnimations += Object.keys(inferred).length;
            if (!configuredAnimationIds.has(npcId)) {
                const ids = Array.from(new Set(observed.filter((id) => Number.isInteger(id) && id >= 0)));
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

        const ids = new Set([
            ...Object.keys(monsters),
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
                    // getExamine() falls back to a generic line, so keep the raw field here.
                    examine: stat.examine ?? definition.examine,
                    hitpoints: stat.hitpoints ?? definition.getHitpoints(),
                    attackSpeed: stat.attackSpeed ?? definition.getAttackSpeed(),
                    maxHit: stat.maxHit ?? definition.getMaxHit(),
                    aggressive: stat.aggressive ?? definition.isAggressive(),
                    poisonous: stat.poisonous ?? definition.isPoisonous(),
                    venomous: stat.venomous ?? definition.isVenomous(),
                    demon: stat.demon ?? definition.isDemon(),
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

            const animation = animations[key];
            if (animation) {
                Object.assign(definition, {
                    attackAnim: animation.anims?.attack ?? definition.getAttackAnim(),
                    defenceAnim: animation.anims?.block ?? definition.getDefenceAnim(),
                    deathAnim: animation.anims?.death ?? definition.getDeathAnim(),
                    spawnAnim: animation.anims?.spawn ?? definition.getSpawnAnim(),
                    deathSound: animation.sounds?.death ?? definition.getDeathSound(),
                });
            }
        }
        (mismatched > 0 ? console.warn : console.debug)(
            `[npc-definitions] cache-backed; configured stats applied=${applied}, mismatched=${mismatched}, ` +
            `service animations inferred=${inferredAnimations}, guessed=${guessedAnimations}`
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
