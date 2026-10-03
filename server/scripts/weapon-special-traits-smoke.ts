// Side-effect import first: primes the same module load order the other combat
// smoke scripts get for free, avoiding an Autocasting <-> CombatSpells cycle.
import "../src/main/typescript/elvarg/game/content/combat/CombatFactory";
import * as assert from "node:assert/strict";
import { AccuracyFormulasDpsCalc } from "../src/main/typescript/elvarg/game/content/combat/formula/AccuracyFormulasDpsCalc";
import { DamageFormulas } from "../src/main/typescript/elvarg/game/content/combat/formula/DamageFormulas";
import { CombatEquipment } from "../src/main/typescript/elvarg/game/content/combat/CombatEquipment";
import { CombatType } from "../src/main/typescript/elvarg/game/content/combat/CombatType";
import { FightStyle } from "../src/main/typescript/elvarg/game/content/combat/FightStyle";
import { BonusManager } from "../src/main/typescript/elvarg/game/model/equipment/BonusManager";
import { PrayerHandler } from "../src/main/typescript/elvarg/game/content/PrayerHandler";
import { Skill } from "../src/main/typescript/elvarg/game/model/Skill";
import { NPC } from "../src/main/typescript/elvarg/game/entity/impl/npc/NPC";
import { NpcDefinition } from "../src/main/typescript/elvarg/game/definition/NpcDefinition";
import { World } from "../src/main/typescript/elvarg/game/World";
import { Location } from "../src/main/typescript/elvarg/game/model/Location";
import { PluginManager } from "../src/main/typescript/elvarg/plugins/PluginManager";
import { CombatSpecial } from "../src/main/typescript/elvarg/game/content/combat/CombatSpecial";
import { ItemIdentifiers } from "../src/main/typescript/elvarg/util/ItemIdentifiers";
import { NpcIdentifiers } from "../src/main/typescript/elvarg/util/NpcIdentifiers";

/**
 * OSRS accuracy / max-hit reference values.
 *
 * Effective attack/strength:
 *   floor(level * prayerPercent/100) + styleBonus + 8   (styleBonus: accurate/aggressive +3,
 *                                                         controlled +1, otherwise 0)
 * Melee attack roll:   effectiveAttack * (attackBonus + 64)
 * Melee max hit:       floor((effectiveStrength * (strengthBonus + 64) + 320) / 640)
 * Ranged max hit:      floor((effectiveRanged * (rangedStrengthBonus + 64) + 320) / 640)
 * Hit chance (wiki):   att > def  -> 1 - (def + 2) / (2 * (att + 1))
 *                      att <= def -> att / (2 * (def + 1))
 */

const item = (id: number) => ({ getId: () => id });

const emptyEquipment = () => ({ getItems: () => new Array(14).fill(null).map(() => item(0)) });

/** Void pieces: helm + top/robe/gloves, no deflector (3 correct pieces is enough). */
const voidEquipment = (helmet: number) => {
    const items: { getId: () => number }[] = new Array(14).fill(null).map(() => item(0));
    items[0] = item(helmet);
    items[4] = item(8839);
    items[7] = item(8840);
    items[9] = item(8842);
    return { getItems: () => items };
};

const prayers = (...ids: number[]) => {
    const active = new Array(30).fill(false);
    for (const id of ids) active[id] = true;
    return active;
};

interface FakePlayerOptions {
    attack?: number;
    strength?: number;
    ranged?: number;
    magic?: number;
    style?: any;
    bonusType?: number;
    attackBonus?: number[];
    defenceBonus?: number[];
    otherBonus?: number[];
    prayerActive?: boolean[];
    equipment?: any;
    special?: any | null;
    specialActivated?: boolean;
}

/** Shell with just the surface the combat formulas touch. */
const fakePlayer = (opts: FakePlayerOptions = {}): any => {
    const levels: Record<number, number> = {
        [Skill.ATTACK.getIndex()]: opts.attack ?? 1,
        [Skill.STRENGTH.getIndex()]: opts.strength ?? 1,
        [Skill.RANGED.getIndex()]: opts.ranged ?? 1,
        [Skill.MAGIC.getIndex()]: opts.magic ?? 1,
        [Skill.DEFENCE.getIndex()]: 1,
    };
    const player: any = {
        isPlayer: () => true,
        isNpc: () => false,
        getAsPlayer: () => player,
        getAsNpc: () => undefined,
        getSkillManager: () => ({ getCurrentLevel: (skill: any) => levels[skill.getIndex()] ?? 1 }),
        getFightType: () => ({
            getStyle: () => opts.style ?? FightStyle.AGGRESSIVE,
            getBonusType: () => opts.bonusType ?? BonusManager.ATTACK_STAB,
        }),
        getBonusManager: () => ({
            getAttackBonus: () => opts.attackBonus ?? [0, 0, 0, 0, 0],
            getDefenceBonus: () => opts.defenceBonus ?? [0, 0, 0, 0, 0],
            getOtherBonus: () => opts.otherBonus ?? [0, 0, 0, 0],
        }),
        getPrayerActive: () => opts.prayerActive ?? prayers(),
        getEquipment: () => opts.equipment ?? emptyEquipment(),
        isSpecialActivated: () => opts.specialActivated ?? false,
        getCombatSpecial: () => opts.special ?? null,
    };
    return player;
};

const special = (traits: any): any => ({
    getTraits: () => traits,
    getAccuracyMultiplier: () => 1,
    getStrengthMultiplier: () => 1,
});

// 1) Melee attack roll = effectiveAttack * (attackBonus + 64).
// Attack 99, no prayer, aggressive: floor(99*1.00) + 0 + 8 = 107.
assert.equal(
    AccuracyFormulasDpsCalc.attackMeleeRoll(
        fakePlayer({ attack: 99, style: FightStyle.AGGRESSIVE, bonusType: 0, attackBonus: [100, 0, 0, 0, 0] })
    ),
    107 * 164, // 17548
    "melee attack roll, +100 stab"
);

// Piety (+20% attack) + accurate style: floor(99*1.20)=118, +3, +8 = 129.
assert.equal(
    AccuracyFormulasDpsCalc.attackMeleeRoll(
        fakePlayer({
            attack: 99,
            style: FightStyle.ACCURATE,
            bonusType: 0,
            attackBonus: [100, 0, 0, 0, 0],
            prayerActive: prayers(PrayerHandler.PIETY),
        })
    ),
    129 * 164, // 21156
    "melee attack roll, Piety + accurate"
);

// Melee void (+10% accuracy): floor(107 * 1.10) = 117.
assert.equal(
    AccuracyFormulasDpsCalc.attackMeleeRoll(
        fakePlayer({
            attack: 99,
            style: FightStyle.AGGRESSIVE,
            bonusType: 0,
            attackBonus: [100, 0, 0, 0, 0],
            equipment: voidEquipment(CombatEquipment.MELEE_VOID_HELM),
        })
    ),
    117 * 164, // 19188
    "melee attack roll, void"
);

// 2) Hit chance matches the OSRS wiki formula for both branches.
{
    const wiki = (att: number, def: number) =>
        att > def ? 1 - (def + 2) / (2 * (att + 1)) : att / (2 * (def + 1));

    assert.equal(AccuracyFormulasDpsCalc.hitChance(20000, 10000), wiki(20000, 10000));
    assert.equal(AccuracyFormulasDpsCalc.hitChance(5000, 10000), wiki(5000, 10000));
    assert.equal(AccuracyFormulasDpsCalc.hitChance(10000, 10000), wiki(10000, 10000));

    // Independent anchors: 1 - 10002/40002 and 5000/20002.
    assert.ok(Math.abs(AccuracyFormulasDpsCalc.hitChance(20000, 10000) - 30000 / 40002) < 1e-12);
    assert.ok(Math.abs(AccuracyFormulasDpsCalc.hitChance(5000, 10000) - 5000 / 20002) < 1e-12);
}

// 3) Ranged max hit = floor((effectiveRanged * (bonus + 64) + 320) / 640).
// Ranged 99, accurate: floor(99) + 3 + 8 = 110; bonus 0.
assert.equal(DamageFormulas.calculateMaxRangedHit(fakePlayer({ ranged: 99, style: FightStyle.ACCURATE })), 11);

// Rigour: ranged strength prayer 123%; floor(99*1.23)=121, +3, +8 = 132.
assert.equal(
    DamageFormulas.calculateMaxRangedHit(
        fakePlayer({
            ranged: 99,
            style: FightStyle.ACCURATE,
            prayerActive: prayers(PrayerHandler.RIGOUR),
        })
    ),
    13, // floor((132*64 + 320) / 640)
    "ranged max hit, Rigour"
);

// Ranged void (+10% strength): floor(110 * 1.10) = 121.
assert.equal(
    DamageFormulas.calculateMaxRangedHit(
        fakePlayer({
            ranged: 99,
            style: FightStyle.ACCURATE,
            equipment: voidEquipment(CombatEquipment.RANGED_VOID_HELM),
        })
    ),
    12, // floor((121*64 + 320) / 640)
    "ranged max hit, void"
);

// 4) Melee max hit uses the same formula.
// Strength 99, aggressive: floor(99) + 3 + 8 = 110; bonus +100.
assert.equal(
    DamageFormulas.calculateMaxMeleeHit(
        fakePlayer({ strength: 99, style: FightStyle.AGGRESSIVE, otherBonus: [100, 0, 0, 0] })
    ),
    28, // floor((110*164 + 320) / 640)
    "melee max hit, +100 strength"
);

// Piety (+23% strength): floor(99*1.23)=121, +3, +8 = 132.
assert.equal(
    DamageFormulas.calculateMaxMeleeHit(
        fakePlayer({
            strength: 99,
            style: FightStyle.AGGRESSIVE,
            otherBonus: [100, 0, 0, 0],
            prayerActive: prayers(PrayerHandler.PIETY),
        })
    ),
    34, // floor((132*164 + 320) / 640)
    "melee max hit, Piety"
);

// 5) Special accuracy stages floor after every stage.
// Base roll: Attack 99 aggressive, +1 stab -> 107 * 65 = 6955.
const baseAttack = { attack: 99, style: FightStyle.AGGRESSIVE, bonusType: 0, attackBonus: [1, 0, 0, 0, 0] };
assert.equal(
    AccuracyFormulasDpsCalc.attackMeleeRoll(
        fakePlayer({ ...baseAttack, special: special({ accuracyMultiplierStages: [1.25, 1.1] }), specialActivated: true })
    ),
    9562, // floor(floor(6955*1.25)*1.1) = floor(floor(8693.75)*1.1) = floor(9562.3)
    "staged special accuracy"
);
assert.equal(
    AccuracyFormulasDpsCalc.attackMeleeRoll(
        fakePlayer({ ...baseAttack, special: special({ accuracyMultiplier: 1.375 }), specialActivated: true })
    ),
    9563, // floor(6955 * 1.375) = floor(9563.125)
    "one-shot special accuracy differs from staged"
);

// 6) Special damage stages round per stage; maxHitOverride replaces the base max hit.
// Base: Strength 99 aggressive, +91 strength -> floor((110*155 + 320)/640) = 27 at base.
const baseDamage = { strength: 99, style: FightStyle.AGGRESSIVE, otherBonus: [91, 0, 0, 0] };
assert.equal(
    DamageFormulas.calculateMaxMeleeHit(
        fakePlayer({
            ...baseDamage,
            special: special({
                damageMultiplierStages: [1.25, 1.1],
                damageMultiplierStageRounding: ["ceil", "floor"],
            }),
            specialActivated: true,
        })
    ),
    37, // ceil(27*1.25)=34, floor(34*1.1)=37
    "staged special damage with per-stage rounding"
);
assert.equal(
    DamageFormulas.calculateMaxMeleeHit(
        fakePlayer({
            ...baseDamage,
            special: special({ damageMultiplierStages: [1.25, 1.1] }),
            specialActivated: true,
        })
    ),
    36, // floor(27*1.25)=33, floor(33*1.1)=36
    "staged special damage defaults to floor"
);
assert.equal(
    DamageFormulas.calculateMaxMeleeHit(
        fakePlayer({
            strength: 99,
            style: FightStyle.AGGRESSIVE,
            otherBonus: [100, 0, 0, 0],
            special: special({ maxHitOverride: 77 }),
            specialActivated: true,
        })
    ),
    77,
    "special maxHitOverride replaces the base max hit"
);

// 7) specialRolls returns the same attack/defence rolls the individual helpers do.
{
    const npc: any = {
        isPlayer: () => false,
        isNpc: () => true,
        getHitpoints: () => 100,
        getAsNpc: () => npc,
        getDefenceLevel: () => 10,
        getCurrentDefinition: () => ({ getStats: () => [0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }),
    };
    const attacks = fakePlayer({ attack: 99, style: FightStyle.AGGRESSIVE, bonusType: 0, attackBonus: [100, 0, 0, 0, 0] });
    const rolls = AccuracyFormulasDpsCalc.specialRolls(attacks, npc, CombatType.MELEE);
    assert.ok(rolls);
    assert.equal(rolls.attack, AccuracyFormulasDpsCalc.attackMeleeRoll(attacks));
    assert.equal(rolls.defence, AccuracyFormulasDpsCalc.defenseMeleeRoll(npc, 0));
}

// 8) rollAttackType / meleeAttackBonusIndex change which attack bonus is used.
{
    const base = fakePlayer({ attack: 99, style: FightStyle.AGGRESSIVE, bonusType: 0, attackBonus: [100, 50, 0, 0, 0] });
    const crush = fakePlayer({
        attack: 99,
        style: FightStyle.AGGRESSIVE,
        bonusType: 0,
        attackBonus: [100, 50, 0, 0, 0],
        special: special({ meleeAttackBonusIndex: 2 }),
        specialActivated: true,
    });
    assert.equal(AccuracyFormulasDpsCalc.attackMeleeRoll(base), 107 * 164);
    // crush bonus is 0, so the roll is the bare effective level * 64.
    assert.equal(AccuracyFormulasDpsCalc.attackMeleeRoll(crush), 107 * 64);
}

// 9) maximumHitSource overrides the max-hit source used by getHitDamage.
{
    const ranged = fakePlayer({
        strength: 99,
        ranged: 1,
        style: FightStyle.AGGRESSIVE,
        otherBonus: [100, 0, 0, 0],
        special: special({ maximumHitSource: "physical_melee" }),
        specialActivated: true,
    });
    assert.equal(
        DamageFormulas.sourceMaxHit(ranged, CombatType.RANGED),
        DamageFormulas.calculateMaxMeleeHit(ranged),
        "physical_melee source uses the melee max hit"
    );
}

// 10) Dragon warhammer drains current Defence at impact, including NPCs and PvP bots.
{
    require("../plugins/combat/specials/DragonWarhammer.SpecialAttack")({
        core: (PluginManager as any).getCoreApi(), registerCombatSpecial: CombatSpecial.register,
    });
    const smash = CombatSpecial.getById("dragon_warhammer")!;
    for (const id of [ItemIdentifiers.DRAGON_WARHAMMER, ItemIdentifiers.DRAGON_WARHAMMER_3, ItemIdentifiers.DRAGON_WARHAMMER_OR_, ItemIdentifiers.DRAGON_WARHAMMER_CR_]) {
        assert.equal(CombatSpecial.getForWeaponId(id), smash, "usable variants share Smash");
    }
    for (const id of [ItemIdentifiers.DRAGON_WARHAMMER_2, ItemIdentifiers.DRAGON_WARHAMMER_4, ItemIdentifiers.DRAGON_WARHAMMER_OR__2, ItemIdentifiers.DRAGON_WARHAMMER_CR__2]) {
        assert.equal(CombatSpecial.getForWeaponId(id), null, "notes and placeholders cannot use Smash");
    }
    const messages: string[] = [];
    const attacker: any = { getAsPlayer: () => ({ sendMessage: (text: string) => messages.push(text) }) };
    const impact = (target: any, damage = 1, accurate = true) => smash.getCombatMethod().handleAfterHitEffects({
        getAttacker: () => attacker, getTarget: () => target, getTotalDamage: () => damage, isAccurate: () => accurate,
    } as any);

    const originalCycle = World.getProcessCycle, originalDefinition = NpcDefinition.forId;
    let cycle = 1000;
    World.getProcessCycle = () => cycle;
    const definition = new NpcDefinition();
    (definition as any).stats = [1, 1, 100, 1, 1, 0, 0, 0, 0, 0, 10, 20, 30, 40, 50];
    NpcDefinition.forId = () => definition;
    try {
        const npc = new NPC(NpcIdentifiers.GENERAL_GRAARDOR, new Location(3200, 3200));
        const other = npc.clone();
        const meleeBefore = AccuracyFormulasDpsCalc.defenseMeleeRoll(npc, BonusManager.ATTACK_CRUSH);
        const rangedBefore = AccuracyFormulasDpsCalc.defenseRangedRoll(npc);
        const magicBefore = AccuracyFormulasDpsCalc.defenseMagicRoll(npc);
        impact(npc, 0);
        impact(npc, 1, false);
        assert.equal(npc.getDefenceLevel(), 100);
        assert.equal(messages.length, 0, "misses and zero damage do not claim a drain");
        impact(npc);
        assert.equal(npc.getDefenceLevel(), 70);
        assert.ok(AccuracyFormulasDpsCalc.defenseMeleeRoll(npc, BonusManager.ATTACK_CRUSH) < meleeBefore, "same-tick melee rolls see the drain");
        assert.ok(AccuracyFormulasDpsCalc.defenseRangedRoll(npc) < rangedBefore, "ranged rolls see the drain");
        assert.equal(AccuracyFormulasDpsCalc.defenseMagicRoll(npc), magicBefore, "NPC magic defence uses Magic");
        assert.equal(other.getDefenceLevel(), 100, "another NPC sharing the definition is unaffected");
        assert.equal(definition.getStats()[2], 100, "shared definitions stay immutable");
        assert.equal(npc.clone().getDefenceLevel(), 100, "respawn starts with full Defence");
        assert.match(messages[0], /by 30, from 100 to 70/);
        cycle += 50;
        impact(npc);
        assert.equal(npc.getDefenceLevel(), 49, "repeated drains use current Defence");
        cycle = 1099;
        assert.equal(npc.getDefenceLevel(), 49);
        cycle = 1100;
        assert.equal(npc.getDefenceLevel(), 50, "one level restores per minute without resetting on another drain");
        cycle = 1500;
        assert.equal(npc.getDefenceLevel(), 54, "restoration catches up across idle cycles");
        cycle = 10000;
        assert.equal(npc.getDefenceLevel(), 100, "restoration stops at base Defence");
        npc.setDefenceLevel(0);
        impact(npc);
        assert.equal(npc.getDefenceLevel(), 0);
        assert.throws(() => npc.setDefenceLevel(NaN), RangeError);

        const bot = fakePlayer();
        let defence = 99, inCombat = true;
        bot.getSkillManager = () => ({
            getCurrentLevel: (skill: Skill) => skill === Skill.DEFENCE ? defence : 99,
            setCurrentLevels: (_: Skill, level: number) => { defence = level; },
            getMaxLevel: () => 99,
            increaseCurrentLevel: (skill: Skill, amount: number) => { if (skill === Skill.DEFENCE) defence += amount; },
        });
        bot.getUsername = () => "drained-bot";
        bot.isRegistered = () => true;
        bot.busy = () => false;
        bot.getHitpoints = () => 99;
        bot.isDyingReturn = () => false;
        bot.getCombat = () => ({ getTarget: () => inCombat ? attacker : null });
        const before = AccuracyFormulasDpsCalc.defenseMeleeRoll(bot, BonusManager.ATTACK_CRUSH);
        impact(bot);
        assert.equal(defence, 70, "player Defence drains too");
        assert.ok(AccuracyFormulasDpsCalc.defenseMeleeRoll(bot, BonusManager.ATTACK_CRUSH) < before);
        const { MaintainCombatBoostsActionNode } = require("../plugins/bots/behaviours/nodes/actions/MaintainCombatBoostsActionNode");
        const boosts = new MaintainCombatBoostsActionNode(new Map([[bot.getUsername(), { mode: "pvp", pvp: { profileId: "standard" } }]]));
        boosts.tick({ player: bot });
        assert.equal(defence, 70, "PvP maintenance cannot erase the drain mid-fight");
        inCombat = false;
        boosts.tick({ player: bot });
        assert.equal(defence, 111, "PvP boosts still apply outside combat");
    } finally {
        World.getProcessCycle = originalCycle;
        NpcDefinition.forId = originalDefinition;
    }
}

console.info("weapon special traits smoke passed");
