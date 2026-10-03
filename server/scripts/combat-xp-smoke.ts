import * as assert from "node:assert/strict";
import { CombatFactory } from "../src/main/typescript/elvarg/game/content/combat/CombatFactory";
import { CombatType } from "../src/main/typescript/elvarg/game/content/combat/CombatType";
import { FightType } from "../src/main/typescript/elvarg/game/content/combat/FightType";
import { WeaponInterfaceManager } from "../src/main/typescript/elvarg/game/content/combat/WeaponInterfaceManager";
import { WeaponInterfaces } from "../src/main/typescript/elvarg/game/content/combat/WeaponInterfaces";
import { Skill } from "../src/main/typescript/elvarg/game/model/Skill";

type Grant = { skill: any; xp: number };

/** Runs rewardExp with fake player/hit shells and returns the skill XP grants. */
function run(combatType: CombatType, skillIndices: number[], damage: number, previousCast: unknown = null): Grant[] {
    const grants: Grant[] = [];
    const player = {
        getSkillManager: () => ({
            addExperience: (skill: any, xp: number) => {
                if (xp > 0) grants.push({ skill, xp });
            },
        }),
        getCombat: () => ({ getPreviousCast: () => previousCast }),
    };
    const hit = {
        getTotalDamage: () => damage,
        getSkills: () => skillIndices,
        getCombatType: () => combatType,
        isAccurate: () => true,
    };
    CombatFactory.rewardExp(player as any, hit as any);
    return grants;
}

const xp = (grants: Grant[], skill: any) => grants.find((grant) => grant.skill === skill)?.xp;
const index = (skill: any) => skill.getIndex();

// OSRS pays 4 XP per damage to the trained melee/ranged style.
assert.equal(xp(run(CombatType.MELEE, [index(Skill.ATTACK)], 1), Skill.ATTACK), 4);
assert.equal(xp(run(CombatType.MELEE, [index(Skill.STRENGTH)], 3), Skill.STRENGTH), 12);
assert.equal(xp(run(CombatType.MELEE, [index(Skill.DEFENCE)], 2), Skill.DEFENCE), 8);
assert.equal(xp(run(CombatType.RANGED, [index(Skill.RANGED)], 5), Skill.RANGED), 20);

// Controlled splits 4/damage across attack/strength/defence (1.33 each).
{
    const grants = run(CombatType.MELEE, [index(Skill.ATTACK), index(Skill.STRENGTH), index(Skill.DEFENCE)], 3);
    assert.equal(xp(grants, Skill.ATTACK), 4);
    assert.equal(xp(grants, Skill.STRENGTH), 4);
    assert.equal(xp(grants, Skill.DEFENCE), 4);
}

// Longrange: 2 ranged + 2 defence per damage.
{
    const grants = run(CombatType.RANGED, [index(Skill.RANGED), index(Skill.DEFENCE)], 5);
    assert.equal(xp(grants, Skill.RANGED), 10);
    assert.equal(xp(grants, Skill.DEFENCE), 10);
}

// Hitpoints: 1.33 per damage (floor 4/3), on every combat style.
assert.equal(xp(run(CombatType.MELEE, [index(Skill.ATTACK)], 3), Skill.HITPOINTS), 4);
assert.equal(xp(run(CombatType.MELEE, [index(Skill.ATTACK)], 1), Skill.HITPOINTS), 1);

// Magic: 2 per damage.
{
    const grants = run(CombatType.MAGIC, [index(Skill.MAGIC)], 3, {});
    assert.equal(xp(grants, Skill.MAGIC), 6);
    assert.equal(xp(grants, Skill.HITPOINTS), 4);
}

// Defensive autocast: 1.33 magic + 1 defence per damage.
{
    const grants = run(CombatType.MAGIC, [index(Skill.MAGIC), index(Skill.DEFENCE)], 3, {});
    assert.equal(xp(grants, Skill.MAGIC), 4);
    assert.equal(xp(grants, Skill.DEFENCE), 3);
    assert.equal(xp(grants, Skill.HITPOINTS), 4);
}

// A 0-damage melee hit grants nothing.
assert.equal(run(CombatType.MELEE, [index(Skill.ATTACK)], 0).length, 0);

// Combat style buttons send their cache slot (varp 43); the weapon's fight
// types come from data/definitions/item-combat-styles.json (cache dbtable 78).
const clickStyle = (weapon: WeaponInterfaces, slot: number, combatType: CombatType = CombatType.MELEE): number[] => {
    const player: any = {
        fightType: FightType.UNARMED_KICK,
        getWeapon: () => weapon,
        getFightType(): FightType {
            return this.fightType;
        },
        setFightType(type: FightType): void {
            this.fightType = type;
        },
        getEquipment: () => ({ hasStaffEquipped: () => weapon === WeaponInterfaces.STAFF }),
        getCombat: () => ({ getAutocastSpell: () => null }),
        getPacketSender: () => ({ sendConfig() { return this; }, sendVarbit() { return this; } }),
    };
    assert.equal(WeaponInterfaceManager.changeCombatStyle(player, slot), true);
    return player.getFightType().getStyle().skill(combatType);
};

// Regression: unarmed Block sits on cache slot 3 and must train Defence.
assert.deepEqual(clickStyle(WeaponInterfaces.UNARMED, 3), [index(Skill.DEFENCE)]);
assert.deepEqual(clickStyle(WeaponInterfaces.WARHAMMER, 3), [index(Skill.DEFENCE)]);
assert.deepEqual(clickStyle(WeaponInterfaces.STAFF, 3), [index(Skill.DEFENCE)]);
// Shared styles train Attack, Strength and Defence.
assert.deepEqual(clickStyle(WeaponInterfaces.SCIMITAR, 2), [index(Skill.ATTACK), index(Skill.STRENGTH), index(Skill.DEFENCE)]);
assert.deepEqual(clickStyle(WeaponInterfaces.WHIP, 1), [index(Skill.ATTACK), index(Skill.STRENGTH), index(Skill.DEFENCE)]);
// Longrange splits Ranged and Defence.
assert.deepEqual(clickStyle(WeaponInterfaces.SHORTBOW, 3, CombatType.RANGED), [index(Skill.RANGED), index(Skill.DEFENCE)]);

console.info("combat xp smoke passed");
