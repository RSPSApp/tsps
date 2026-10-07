
import { PendingHit } from "../hit/PendingHit";
import { Mobile } from "../../../entity/impl/Mobile";
import { Player } from "../../../entity/impl/player/Player";
import { Animation } from "../../../model/Animation";
import {  EffectTimer } from "../../../model/EffectTimer";
import { Graphic } from "../../../model/Graphic";
import { GraphicHeight } from "../../../model/GraphicHeight";
import { Item } from "../../../model/Item";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { Projectile } from "../../../model/Projectile";
import { Skill } from "../../../model/Skill";
import { Sound } from "../../../Sound";
import { Misc } from "../../../../util/Misc";
import { ItemIdentifiers } from "../../../../util/ItemIdentifiers";
import { Equipment } from "../../../model/container/impl/Equipment";
import { Flag } from "../../../model/Flag";
import { PrayerHandler } from "../../PrayerHandler";
import { CombatEffectSpell } from "./CombatEffectSpell";
import { CombatNormalSpell, CombatNormalSpellOptions } from "./CombatNormalSpell";
import { CombatSpell } from "./CombatSpell";
import { Spell } from "./Spell";

/**
 * Charge-based combat spell for the powered staves (tridents). OSRS charges
 * these with runes/coins (seas) or runes/Zulrah scales (swamp) rather than
 * consuming inventory runes per cast - charges are consumed one-per-cast and
 * the weapon simply can't cast once depleted. See plugins/items/Trident.plugin.js
 * for the charging interaction; both sides share state via TRIDENT_CHARGE_META_KEY.
 */
export const TRIDENT_CHARGE_META_KEY = "trident-charges";
export const TRIDENT_MAX_CHARGES = 2500;

class TridentSpell extends CombatNormalSpell {
    constructor(
        options: CombatNormalSpellOptions,
        private readonly chargedWeaponId: number,
        private readonly unchargedWeaponId: number,
    ) {
        super(options);
    }

    canCast(player: Player, del: boolean): boolean {
        if (!super.canCast(player, del)) {
            return false;
        }

        const weapon = player.getEquipment().get(Equipment.WEAPON_SLOT);
        const weaponId = weapon?.getId();
        if (weaponId !== this.chargedWeaponId && weaponId !== this.unchargedWeaponId) {
            return true;
        }

        const charges = Math.max(0, Number(weapon.getMetaValue(TRIDENT_CHARGE_META_KEY)) || 0);
        if (charges <= 0) {
            player.sendMessage("Your trident has run out of charges.");
            player.getCombat().reset();
            return false;
        }

        if (!del) {
            return true;
        }

        const remaining = charges - 1;
        weapon.setMetaValue(TRIDENT_CHARGE_META_KEY, remaining);
        if (remaining <= 0 && weapon.getId() !== this.unchargedWeaponId) {
            weapon.setId(this.unchargedWeaponId);
            player.getEquipment().refreshItems();
            player.getUpdateFlag().flag(Flag.APPEARANCE);
        }
        return true;
    }
}

class ChargeSpell extends Spell {
    spellId(): number { return 0; }
    levelRequired(): number { return 80; }
    baseExperience(): number { return 180; }
    itemsRequired(): Item[] { return [new Item(556, 3), new Item(554, 3), new Item(565, 3)]; }
    equipmentRequired(): Item[] { return []; }
    startCast(): void { }

    cast(player: Player): boolean {
        if (!this.canCast(player, false) || !this.canCast(player, true)) {
            return true;
        }
        player.getSkillManager().addExperiences(Skill.MAGIC, this.baseExperience());
        player.setAttribute(CombatSpells.CHARGE_UNTIL, Date.now() + 420_000);
        player.sendMessage("You feel charged with magical power.");
        return true;
    }
}

/** A grasp's bind (Wiki): its chance (doubled by Mark of Darkness), length, and target graphics. */
type GraspBind = { chance: number; ticks: number; bound: number; unbound: number };

/** Grasp binds rolled at the cast, applied when each hit lands (first in, first out). */
const pendingBinds = new WeakMap<Mobile, boolean[]>();

class CombatArceuusSpell extends CombatNormalSpell {
    constructor(
        options: CombatNormalSpellOptions,
        private readonly demonbane = false,
        private readonly grasp: GraspBind | null = null,
    ) {
        super(options);
    }

    /** Wiki (Hit delay): grasps land after 1 tick and demonbanes after 2, whatever the distance. */
    public hitDelay(): number {
        return this.demonbane ? 2 : 1;
    }

    /**
     * A grasp that hits rolls its bind at the cast and shows it on the target 30 cycles later
     * (capture, Undead Grasp: the bind graphic or the plain impact, sent with the cast).
     */
    public onHitCalc(hit: PendingHit): void {
        super.onHitCalc(hit);
        const grasp = this.grasp;
        if (!grasp || !hit.isAccurate()) return;
        const caster = hit.getAttacker();
        const target = hit.getTarget();
        const marked = caster.isPlayer() && hasArceuusMark(caster);
        const binds = Math.random() * 100 < (marked ? grasp.chance * 2 : grasp.chance);
        target.performGraphic(new Graphic(binds ? grasp.bound : grasp.unbound, GRASP_IMPACT_DELAY));
        const queue = pendingBinds.get(target) ?? [];
        queue.push(binds);
        pendingBinds.set(target, queue);
    }

    /** The bind takes hold when the hit lands: its ticks, 1 against Ward of Arceuus. */
    public finishCast(cast: Mobile, castOn: Mobile, accurate: boolean, damage: number): void {
        super.finishCast(cast, castOn, accurate, damage);
        if (!this.grasp || !accurate) return;
        const binds = pendingBinds.get(castOn)?.shift() ?? false;
        if (!binds) return;
        const ticks = castOn.isPlayer() && hasArceuusWard(castOn) ? 1 : this.grasp.ticks;
        getCombatFactory().freeze(castOn, ticks * 0.6);
    }

    public getSpellbook(): MagicSpellbook {
        return MagicSpellbook.ARCEUUS;
    }

    public getAttackSpeed(): number {
        return 4;
    }

    /**
     * Wiki (demonbane spells, which only demons can be hit with): +20% accuracy; with Mark of Darkness
     * +40% accuracy and +25% damage, doubled to +80% and +50% with a purging staff.
     */
    public demonbaneDamageMultiplier(caster: Mobile | null): number {
        if (!this.demonbane || !caster?.isPlayer() || !hasArceuusMark(caster)) return 1;
        return wieldsPurgingStaff(caster) ? 1.5 : 1.25;
    }

    public demonbaneAccuracyMultiplier(caster: Mobile | null): number {
        if (!this.demonbane || !caster?.isPlayer()) return 1;
        if (!hasArceuusMark(caster)) return 1.2;
        return wieldsPurgingStaff(caster) ? 1.8 : 1.4;
    }

    public canCastOnTarget(cast: Mobile, target: Mobile): boolean {
        if (!this.demonbane || !target.isNpc()) {
            return !this.demonbane || this.rejectInvalidDemonbaneTarget(cast);
        }

        if (target.getAsNpc().getCurrentDefinition()?.isDemon?.()) {
            return true;
        }
        return this.rejectInvalidDemonbaneTarget(cast);
    }

    private rejectInvalidDemonbaneTarget(cast: Mobile): false {
        if (cast.isPlayer()) {
            cast.getAsPlayer().sendMessage("Demonbane spells can only be cast on demons.");
        }
        return false;
    }
}

class CombatArceuusEffectSpell extends CombatEffectSpell {
    public getSpellbook(): MagicSpellbook {
        return MagicSpellbook.ARCEUUS;
    }

    public getAttackSpeed(): number {
        return 4;
    }
}

/** Wiki: Dark Lure has a 10.2-second cooldown. */
class DarkLureSpell extends CombatArceuusEffectSpell {
    protected getCastCooldown() {
        return { attribute: "arceuus:dark-lure-cooldown", duration: 10_200 };
    }
}

const ARCEUUS_MARK_UNTIL = "arceuus:mark-until";

const hasArceuusMark = (target: Mobile): boolean =>
    Number(target.getAttribute(ARCEUUS_MARK_UNTIL) ?? 0) > Date.now();
const hasArceuusWard = (target: Mobile): boolean =>
    Number(target.getAttribute("arceuus:ward-until") ?? 0) > Date.now();
const PURGING_STAFFS = new Set([29594, 29595]);
const wieldsPurgingStaff = (caster: Mobile): boolean =>
    PURGING_STAFFS.has(caster.getAsPlayer().getEquipment().getWeapon()?.getId?.() ?? -1);

/** The cache's Arceuus combat-spell animations (human_spellcast_grasp / _demonbane). */
const GRASP_ANIMATION = 8972;
const DEMONBANE_ANIMATION = 8977;

/** Capture (Undead Grasp): the target's graphic is sent with the cast, 30 cycles on. */
const GRASP_IMPACT_DELAY = 30;

const getCombatFactory = () =>
    require("../CombatFactory").CombatFactory as typeof import("../CombatFactory").CombatFactory;

export class CombatAncientSpellExtend extends CombatSpell {
    constructor(private readonly castAnimationFunction: Function, private readonly startGraphicFunction: Function, private readonly spellEffectOnHitCalcFunction: Function, private readonly spellRadiusFunction: Function, private readonly castProjectileFunction: Function, private readonly endGraphicFunction: Function, private readonly maximumHitFunction: Function, private readonly baseExperienceFunction: Function, private readonly itemsRequiredFunction: Function, private readonly levelRequiredFunction: Function, private readonly spellIdFunction: Function, private readonly impactSoundFunction?: Function) {
        super();
    }

    public spellRadius(): number {
        return this.spellRadiusFunction();
    }

    public getSpellbook(): MagicSpellbook {
        return MagicSpellbook.ANCIENT;
    }

    public equipmentRequired(player: Player): Item[] {
        return null;
    }

    public finishCast(cast: Mobile, castOn: Mobile, accurate: boolean, damage: number): void {
        if (!accurate || damage <= 0) {
            return;
        }
        this.spellEffect(cast, castOn, damage);
    }

    public spellEffect(cast: Mobile, castOn: Mobile, damage: number): void {}

    spellId(): number {
        return this.spellIdFunction();
    }

    maximumHit(): number {
        return this.maximumHitFunction();
    }

    castAnimation(): Animation {
        return this.castAnimationFunction();
    }

    startGraphic(): Graphic {
        return this.startGraphicFunction();
    }

    castProjectile(cast: Mobile, castOn: Mobile): Projectile {
        return this.castProjectileFunction(cast, castOn);
    }

    endGraphic(): Graphic {
        return this.endGraphicFunction();
    }

    public spellEffectOnHitCalc(cast: Mobile, castOn: Mobile, damage: number): void {
        this.spellEffectOnHitCalcFunction(cast, castOn, damage);
    }

    public impactSound(): Sound {
        return this.impactSoundFunction ? this.impactSoundFunction() : null;
    }

    public baseExperience(): number {
        return this.baseExperienceFunction();
    }

    public itemsRequired(player: Player): Item[] {
        return this.itemsRequiredFunction(player);
    }

    public levelRequired(): number {
        return this.levelRequiredFunction();
    }

    public getSpell(): CombatSpell {
        return this;
    }
}



export class CombatSpells {
    public static readonly CHARGE_UNTIL = "charge:until";
    private static readonly CHARGE = new ChargeSpell();
    private static readonly GOD_SPELL_CAPES = new Map<number, Set<number>>([
        [1190, new Set([ItemIdentifiers.SARADOMIN_CAPE, ItemIdentifiers.SARADOMIN_CAPE_2, ItemIdentifiers.IMBUED_SARADOMIN_CAPE, ItemIdentifiers.IMBUED_SARADOMIN_CAPE_2, ItemIdentifiers.IMBUED_SARADOMIN_CAPE_3, ItemIdentifiers.IMBUED_SARADOMIN_CAPE_4])],
        [1191, new Set([ItemIdentifiers.GUTHIX_CAPE, ItemIdentifiers.GUTHIX_CAPE_2, ItemIdentifiers.IMBUED_GUTHIX_CAPE, ItemIdentifiers.IMBUED_GUTHIX_CAPE_2, ItemIdentifiers.IMBUED_GUTHIX_CAPE_3, ItemIdentifiers.IMBUED_GUTHIX_CAPE_4])],
        [1192, new Set([ItemIdentifiers.ZAMORAK_CAPE, ItemIdentifiers.ZAMORAK_CAPE_2, ItemIdentifiers.IMBUED_ZAMORAK_CAPE, ItemIdentifiers.IMBUED_ZAMORAK_CAPE_2, ItemIdentifiers.IMBUED_ZAMORAK_CAPE_3, ItemIdentifiers.IMBUED_ZAMORAK_CAPE_4])],
    ]);

    public static handleSelf(player: Player, name: string | undefined): boolean {
        return name?.trim().toLowerCase() === "charge" && this.CHARGE.cast(player);
    }

    public static applyChargeMaxHit(caster: Mobile, maxHit: number, spell?: CombatSpell | null): number {
        if (!caster.isPlayer() || Number(caster.getAttribute(this.CHARGE_UNTIL) ?? 0) <= Date.now()) {
            return maxHit;
        }
        const player = caster.getAsPlayer();
        const capes = this.GOD_SPELL_CAPES.get((spell ?? player.getCombat().getSelectedSpell())?.spellId());
        return capes?.has(player.getEquipment().get(Equipment.CAPE_SLOT).getId()) ? 30 : maxHit;
    }
    public static WIND_STRIKE = new CombatNormalSpell({
        castAnimation() {
            return new Animation(711);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 91, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(92, GraphicHeight.HIGH);
        },
        maximumHit() {
            return 2;
        },
        startGraphic() {
            return new Graphic(90, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 5;
        },
        equipmentRequired(player) {
            return null;
        },
        itemsRequired(player) {
            return [new Item(556), new Item(558)];
        },

        levelRequired() {
            return 1;
        },
        spellId() {
            return 1152;
        }
    });

    public static CONFUSE = new CombatEffectSpell({
        castAnimation() {
            return new Animation(716);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 103, 0, 20, 43, 31);
        },
        spellEffect(cast, castOn) {
            if (castOn.isPlayer()) {
                const player = castOn as Player;
                if (player.getSkillManager().getCurrentLevel(Skill.ATTACK) < player.getSkillManager().getMaxLevel(Skill.ATTACK)) {
                    if (cast.isPlayer()) {
                        (cast as Player).sendMessage("The spell has no effect because the player has already been weakened.");
                    }
                    return;
                }
                const decrease = Math.floor(0.05 * (player.getSkillManager().getCurrentLevel(Skill.ATTACK)));
                player.getSkillManager().setCurrentLevelCombat(Skill.ATTACK, player.getSkillManager().getCurrentLevel(Skill.ATTACK) - decrease);
                player.getSkillManager().updateSkill(Skill.ATTACK);
                player.sendMessage("You feel slightly weakened.");
            }
        },
        endGraphic() {
            return new Graphic(104, GraphicHeight.HIGH);
        },
        startGraphic() {
            return new Graphic(102, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 13;
        },
        itemsRequired(player) {
            return [new Item(555, 3), new Item(557, 2), new Item(559)];
        },
        levelRequired() {
            return 3;
        },
        spellId() {
            return 1153;
        }
    });

    public static WATER_STRIKE = new CombatNormalSpell({
        castAnimation: () => {
            return new Animation(711);
        },
        castProjectile: (cast, castOn) => {
            return Projectile.createProjectile(cast, castOn, 94, 0, 20, 43, 31);
        },
        endGraphic: () => {
            return new Graphic(95, GraphicHeight.HIGH);
        },
        maximumHit: () => {
            return 4;
        },
        startGraphic: () => {
            return new Graphic(93, GraphicHeight.HIGH);
        },
        baseExperience: () => {
            return 7;
        },
        equipmentRequired: (player) => {
            return null;
        },
        itemsRequired(player): Item[] {
            return [new Item(555), new Item(556), new Item(558)];
        },
        levelRequired: () => {
            return 5;
        },
        spellId: () => {
            return 1154;
        },
    });

    public static EARTH_STRIKE = new CombatNormalSpell({
        castAnimation() {
            return new Animation(711);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 97, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(98, GraphicHeight.HIGH);
        },
        maximumHit() {
            return 6;
        },
        startGraphic() {
            return new Graphic(96, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 9;
        },
        equipmentRequired(player) {
            return undefined;
        },
        itemsRequired(player): Item[] {
            return [new Item(556, 1), new Item(558, 1), new Item(557, 2)];
        },
        levelRequired() {
            return 9;
        },
        spellId() {
            return 1156;
        },
    });

    public static WEAKEN = new CombatEffectSpell({
        castAnimation() {
            return new Animation(716);
        },

        castProjectile(cast: Mobile, castOn: Mobile) {
            return Projectile.createProjectile(cast, castOn, 106, 0, 20, 43, 31);
        },

        spellEffect(cast: Mobile, castOn: Mobile) {
            if (castOn.isPlayer()) {
                let player = castOn as Player;

                if (player.getSkillManager().getCurrentLevel(Skill.STRENGTH) < player.getSkillManager().getMaxLevel(Skill.STRENGTH)) {
                    if (cast.isPlayer()) {
                        (cast as Player).sendMessage(
                            "The spell has no effect because the player has already been weakened."
                        );
                    }
                    return;
                }

                let decrease = Math.floor(0.05 * player.getSkillManager().getCurrentLevel(Skill.STRENGTH));
                player.getSkillManager().setCurrentLevelCombat(Skill.STRENGTH, player.getSkillManager().getCurrentLevel(Skill.STRENGTH) - decrease);
                player.getSkillManager().updateSkill(Skill.STRENGTH);
                player.sendMessage(
                    "You feel slightly weakened."
                );
            } /*else if (castOn.isNpc()) {
                    let npc = castOn as NPC;
        
                    if (npc.getDefenceWeakened()[1] || npc.getStrengthWeakened()[1]) {
                        if (cast.isPlayer()) {
                            (cast as Player).sendMessage(
                                "The spell has no effect because the NPC has already been weakened."
                            );
                        }
                        return;
                    }
        
                    npc.getDefenceWeakened()[1] = true;
                }*/
        },

        endGraphic() {
            return new Graphic(107, GraphicHeight.HIGH);
        },

        startGraphic() {
            return new Graphic(105, GraphicHeight.HIGH);
        },

        baseExperience() {
            return 21;
        },

        itemsRequired(player: Player) {
            return [new Item(555, 3), new Item(557, 2), new Item(559, 1)];
        },

        levelRequired() {
            return 11;
        },

        spellId() {
            return 1157;
        },

        getSpellbook() {
            return null;
        },
    });

    public static FIRE_STRIKE = new CombatNormalSpell({
        castAnimation() {
            return new Animation(711);
        },


        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 100, 0, 20, 43, 31);
        },

        endGraphic() {
            return new Graphic(101, GraphicHeight.HIGH);
        },

        maximumHit() {
            return 8;
        },

        startGraphic() {
            return new Graphic(99, GraphicHeight.HIGH);
        },

        baseExperience() {
            return 11;
        },

        equipmentRequired(player) {
            return null;
        },

        itemsRequired(player) {
            return [new Item(556, 1), new Item(558, 1), new Item(554, 3)];
        },

        levelRequired() {
            return 13;
        },

        spellId() {
            return 1158;
        }
    });

    public static WIND_BOLT = new CombatNormalSpell({
        castAnimation: () => {
            return new Animation(711);
        },

        castProjectile: (cast, castOn) => {
            return Projectile.createProjectile(cast, castOn, 118, 0, 20, 43, 31);
        },

        endGraphic: () => {
            return new Graphic(119, GraphicHeight.HIGH);
        },

        maximumHit: () => {
            return 9;
        },

        startGraphic: () => {
            return new Graphic(117, GraphicHeight.HIGH);
        },

        baseExperience: () => {
            return 13;
        },

        equipmentRequired: (player: Player) => {
            return undefined;
        },

        itemsRequired: (player: Player) => {
            return [new Item(556, 2), new Item(562, 1)];
        },

        levelRequired: () => {
            return 17;
        },

        spellId: () => {
            return 1160;
        }
    });

    public static CURSE = new CombatEffectSpell({
        castAnimation() {
            return new Animation(710);
        },

        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 109, 0, 20, 43, 31);
        },

        spellEffect(cast, castOn) {
            if (castOn.isPlayer()) {
                const player = castOn as Player;

                if (player.getSkillManager().getCurrentLevel(Skill.DEFENCE) < player.getSkillManager().getMaxLevel(Skill.DEFENCE)) {
                    if (cast.isPlayer()) {
                        (cast as Player).sendMessage("The spell has no effect because the player has already been weakened.");
                    }
                    return;
                }

                const decrease = Math.floor(0.05 * player.getSkillManager().getCurrentLevel(Skill.DEFENCE));
                player.getSkillManager().setCurrentLevelCombat(Skill.DEFENCE, player.getSkillManager().getCurrentLevel(Skill.DEFENCE) - decrease);
                player.getSkillManager().updateSkill(Skill.DEFENCE);

                player.sendMessage("You feel slightly weakened.");
            }/* else if (castOn.isNpc()) {
                const npc = castOn as NPC;
        
                if (npc.getDefenceWeakened()[2] || npc.getStrengthWeakened()[2]) {
                    if (cast.isPlayer()) {
                        (cast as Player).sendMessage("The spell has no effect because the NPC has already been weakened.");
                    }
                    return;
                }
        
                npc.getDefenceWeakened()[2] = true;
            }*/
        },

        endGraphic() {
            return new Graphic(110, GraphicHeight.HIGH);
        },

        startGraphic() {
            return new Graphic(108, GraphicHeight.HIGH);
        },

        baseExperience() {
            return 29;
        },

        itemsRequired(player) {
            return [new Item(555, 2), new Item(557, 3), new Item(559, 1)];
        },

        levelRequired() {
            return 19;
        },

        spellId() {
            return 1161;
        }
    });

    public static BIND = new CombatEffectSpell({
        castAnimation: () => {
            return new Animation(710);
        },

        castProjectile: (cast, castOn) => {
            return Projectile.createProjectile(cast, castOn, 178, 0, 20, 43, 31);
        },

        spellEffect: (cast, castOn) => {
            getCombatFactory().freeze(castOn, 5);
        },

        endGraphic: () => {
            return new Graphic(181, GraphicHeight.HIGH);
        },

        startGraphic: () => {
            return new Graphic(177, GraphicHeight.HIGH);
        },

        baseExperience: () => {
            return 30;
        },

        itemsRequired: (player) => {
            return [new Item(555, 3), new Item(557, 3), new Item(561, 2)];
        },

        levelRequired: () => {
            return 20;
        },

        spellId: () => {
            return 1572;
        }
    });

    public static WATER_BOLT = new CombatNormalSpell({
        castAnimation() {
            return new Animation(711);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 121, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(122, GraphicHeight.HIGH);
        },
        maximumHit() {
            return 10;
        },
        startGraphic() {
            return new Graphic(120, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 16;
        },
        equipmentRequired(player) {
            return null;
        },
        itemsRequired(player) {
            return [new Item(556, 2), new Item(562, 1), new Item(555, 2)];
        },
        levelRequired() {
            return 23;
        },
        spellId() {
            return 1163;
        }
    });

    public static EARTH_BOLT = new CombatNormalSpell({
        castAnimation() {
            return new Animation(711);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 124, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(125, GraphicHeight.HIGH);
        },
        maximumHit() {
            return 11;
        },
        startGraphic() {
            return new Graphic(123, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 19;
        },
        equipmentRequired(player) {
            return null;
        },
        itemsRequired(player) {
            return [new Item(556, 2), new Item(562, 1), new Item(557, 3)];
        },
        levelRequired() {
            return 29;
        },
        spellId() {
            return 1166;
        }
    });

    public static FIRE_BOLT = new CombatNormalSpell({
        castAnimation() {
            return new Animation(711);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 127, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(128, GraphicHeight.HIGH);
        },
        maximumHit() {
            return 12;
        },
        startGraphic() {
            return new Graphic(126, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 22;
        },
        equipmentRequired(player) {
            return null;
        },
        itemsRequired(player) {
            return [new Item(556, 3), new Item(562, 1), new Item(554, 4)];
        },
        levelRequired() {
            return 35;
        },
        spellId() {
            return 1169;
        }
    });

    public static CRUMBLE_UNDEAD = new CombatNormalSpell({
        castAnimation() {
            return new Animation(724);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 146, 0, 20, 43, 31)
                ;
        },
        endGraphic() {
            return new Graphic(147);
        },
        maximumHit() {
            return 15;
        },
        startGraphic() {
            return new Graphic(145, 6553600);
        },
        baseExperience() {
            return 24;
        },
        equipmentRequired(player) {
            return null;
        },
        itemsRequired(player) {
            return [
                new Item(556, 2),
                new Item(562, 1),
                new Item(557, 2),
            ];
        },
        levelRequired() {
            return 39;
        },
        spellId() {
            return 1171;
        },
    });

    public static WIND_BLAST = new CombatNormalSpell({
        castAnimation() {
            return new Animation(711);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 133, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(134, GraphicHeight.HIGH);
        },
        maximumHit() {
            return 13;
        },
        startGraphic() {
            return new Graphic(132, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 25;
        },
        equipmentRequired(player) {
            return null;
        },
        itemsRequired(player) {
            return [
                new Item(556, 3),
                new Item(560, 1),
            ];
        },
        levelRequired() {
            return 41;
        },
        spellId() {
            return 1172;
        },
    });

    public static WATER_BLAST = new CombatNormalSpell({
        castAnimation() {
            return new Animation(711);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 136, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(137, GraphicHeight.HIGH);
        },
        maximumHit() {
            return 14;
        },
        startGraphic() {
            return new Graphic(135, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 28;
        },
        equipmentRequired(player) {
            return null;
        },
        itemsRequired(player) {
            return [
                new Item(555, 3),
                new Item(556, 3),
                new Item(560, 1),
            ];
        },
        levelRequired() {
            return 47;
        },
        spellId() {
            return 1175;
        },
    });

    public static IBAN_BLAST = new CombatNormalSpell({
        members: true,
        castAnimation() {
            return new Animation(708);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 88, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(89);
        },
        maximumHit() {
            return 25;
        },
        startGraphic() {
            return new Graphic(87, 6553600);
        },
        baseExperience() {
            return 30;
        },
        equipmentRequired(player) {
            return [new Item(1409)];
        },
        itemsRequired(player) {
            return [new Item(560, 1), new Item(554, 5)];
        },
        levelRequired() {
            return 50;
        },
        spellId() {
            return 1539;
        }
    });

    public static SNARE = new CombatEffectSpell({
        members: true,
        castAnimation() {
            return new Animation(710);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 178, 0, 20, 43, 31);
        },
        spellEffect(cast, castOn) {
            getCombatFactory().freeze(castOn, 10);
        },
        endGraphic() {
            return new Graphic(180, GraphicHeight.HIGH);
        },
        startGraphic() {
            return new Graphic(177, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 60;
        },
        itemsRequired(player) {
            return [new Item(555, 3), new Item(557, 4), new Item(561, 3)];
        },
        levelRequired() {
            return 50;
        },
        spellId() {
            return 1582;
        }
    });

    public static MAGIC_DART = new CombatNormalSpell({
        members: true,
        castAnimation() {
            return new Animation(1576);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 328, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(329);
        },
        maximumHit() {
            return 19;
        },
        startGraphic() {
            return new Graphic(327, 6553600);
        },
        baseExperience() {
            return 30;
        },
        equipmentRequired(player) {
            return [new Item(4170)];
        },
        itemsRequired(player) {
            return [new Item(558, 4), new Item(560, 1)];
        },
        levelRequired() {
            return 50;
        },
        spellId() {
            return 12037;
        }
    })

    public static EARTH_BLAST = new CombatNormalSpell({
        castAnimation: () => {
            return new Animation(711);
        },
        castProjectile: (cast, castOn) => {
            return Projectile.createProjectile(cast, castOn, 139, 0, 20, 43, 31);
        },
        endGraphic: () => {
            return new Graphic(140, GraphicHeight.HIGH);
        },
        maximumHit: () => {
            return 15;
        },
        startGraphic: () => {
            return new Graphic(138, GraphicHeight.HIGH);
        },
        baseExperience: () => {
            return 31;
        },
        equipmentRequired: (player: Player) => {
            return undefined;
        },
        itemsRequired: (player: Player) => {
            return [new Item(556, 3), new Item(560, 1), new Item(557, 4)];
        },
        levelRequired: () => {
            return 53;
        },
        spellId: () => {
            return 1177;
        }
    });

    public static FIRE_BLAST = new CombatNormalSpell({
        castAnimation: () => {
            return new Animation(711);
        },
        castProjectile: (cast, castOn) => {
            return Projectile.createProjectile(cast, castOn, 130, 0, 20, 43, 31);
        },
        endGraphic: () => {
            return new Graphic(131, GraphicHeight.HIGH);
        },
        maximumHit: () => {
            return 16;
        },
        startGraphic: () => {
            return new Graphic(129, GraphicHeight.HIGH);
        },
        baseExperience: () => {
            return 34;
        },
        equipmentRequired: (player: Player) => {
            return undefined;
        },
        itemsRequired: (player: Player) => {
            return [new Item(556, 4), new Item(560, 1), new Item(554, 5)];
        },
        levelRequired: () => {
            return 59;
        },
        spellId: () => {
            return 1181;
        }
    });

    public static SARADOMIN_STRIKE = new CombatNormalSpell({
        members: true,
        castAnimation: () => {
            return new Animation(811);
        },
        castProjectile: (cast, castOn) => {
            return undefined;
        },
        endGraphic: () => {
            return new Graphic(76);
        },
        maximumHit: () => {
            return 20;
        },
        startGraphic: () => {
            return undefined;
        },
        baseExperience: () => {
            return 35;
        },
        equipmentRequired: (player: Player) => {
            return [new Item(2415)];
        },
        itemsRequired: (player: Player) => {
            return [new Item(556, 4), new Item(565, 2), new Item(554, 2)];
        },
        levelRequired: () => {
            return 60;
        },
        spellId: () => {
            return 1190;
        }
    });

    public static CLAWS_OF_GUTHIX = new CombatNormalSpell({
        members: true,
        castAnimation: () => {
            return new Animation(811);
        },
        castProjectile: (cast: Mobile, castOn: Mobile): Projectile => {
            return null;
        },
        endGraphic: (): Graphic => {
            return new Graphic(77);
        },
        maximumHit: (): number => {
            return 20;
        },
        startGraphic: (): Graphic => {
            return null;
        },
        baseExperience: (): number => {
            return 35;
        },
        equipmentRequired: (player: Player): Item[] => {
            return [new Item(2416)];
        },
        itemsRequired: (player: Player): Item[] => {
            return [new Item(556, 4), new Item(565, 2), new Item(554, 2)];
        },
        levelRequired: (): number => {
            return 60;
        },
        spellId: (): number => {
            return 1191;
        }
    });

    public static FLAMES_OF_ZAMORAK = new CombatNormalSpell({
        members: true,
        castAnimation() {
            return new Animation(811);
        },
        castProjectile: (cast: Mobile, castOn: Mobile): Projectile => {
            return null;
        },
        endGraphic: (): Graphic => {
            return new Graphic(78);
        },
        maximumHit: (): number => {
            return 20;
        },
        startGraphic: (): Graphic => {
            return null;
        },
        baseExperience: (): number => {
            return 35;
        },
        equipmentRequired: (player: Player): Item[] => {
            return [new Item(2417)];
        },
        itemsRequired: (player: Player): Item[] => {
            return [new Item(556, 4), new Item(565, 2), new Item(554, 2)];
        },
        levelRequired: (): number => {
            return 60;
        },
        spellId: (): number => {
            return 1192;
        }
    });

    public static WIND_WAVE = new CombatNormalSpell({
        members: true,
        castAnimation() {
            return new Animation(727);
        },
        castProjectile: (cast: Mobile, castOn: Mobile): Projectile => {
            return Projectile.createProjectile(cast, castOn, 159, 0, 20, 43, 31);
        },
        endGraphic: (): Graphic => {
            return new Graphic(160, GraphicHeight.HIGH);
        },
        maximumHit: (): number => {
            return 17;
        },
        startGraphic: (): Graphic => {
            return new Graphic(158, GraphicHeight.MIDDLE);
        },
        baseExperience: (): number => {
            return 36;
        },
        equipmentRequired: (player: Player): Item[] => {
            return null;
        },
        itemsRequired: (player: Player): Item[] => {
            return [new Item(556, 5), new Item(565, 1)];
        },
        levelRequired: (): number => {
            return 62;
        },
        spellId: (): number => {
            return 1183;
        }
    });

    public static WATER_WAVE = new CombatNormalSpell({
        members: true,
        castAnimation() {
            return new Animation(727);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 162, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(163, GraphicHeight.HIGH);
        },
        maximumHit() {
            return 18;
        },
        startGraphic() {
            return new Graphic(161, GraphicHeight.MIDDLE);
        },
        baseExperience() {
            return 37;
        },
        equipmentRequired(player) {
            return null;
        },
        itemsRequired(player) {
            return [new Item(556, 5), new Item(565, 1), new Item(555, 7)];
        },
        levelRequired() {
            return 65;
        },
        spellId() {
            return 1185;
        }
    });

    public static VULNERABILITY = new CombatEffectSpell({
        members: true,
        castAnimation() {
            return new Animation(729);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 168, 0, 20, 43, 31);
        },
        spellEffect(cast, castOn) {
            if (castOn.isPlayer()) {
                let player = castOn as Player;


                if (player.getSkillManager().getCurrentLevel(Skill.DEFENCE) < player.getSkillManager().getMaxLevel(Skill.DEFENCE)) {
                    if (cast.isPlayer()) {
                        (cast as Player).sendMessage("The spell has no effect because the player is already weakened.");
                    }
                    return;
                }

                let decrease = Math.floor(0.10 * player.getSkillManager().getCurrentLevel(Skill.DEFENCE));
                player.getSkillManager().setCurrentLevelCombat(Skill.DEFENCE, player.getSkillManager().getCurrentLevel(Skill.DEFENCE) - decrease);
                player.getSkillManager().updateSkill(Skill.DEFENCE);
                player.sendMessage("You feel slightly weakened.");
            }/* else if (castOn.isNpc()) {
                let npc = castOn as NPC;
        
                if (npc.getDefenceWeakened()[2] || npc.getStrengthWeakened()[2]) {
                    if (cast.isPlayer()) {
                        (cast as Player).sendMessage("The spell has no effect because the NPC is already weakened.");
                    }
                    return;
                }
        
                npc.getStrengthWeakened()[2] = true;
            }*/
        },
        endGraphic() {
            return new Graphic(169);
        },
        startGraphic() {
            return new Graphic(167, 6553600);
        },
        baseExperience() {
            return 76;
        },
        itemsRequired(player) {
            return [new Item(557, 5), new Item(555, 5), new Item(566, 1)];
        },
        levelRequired() {
            return 66;
        },
        spellId() {
            return 1542;
        }
    });

    public static EARTH_WAVE = new CombatNormalSpell({
        members: true,
        castAnimation() {
            return new Animation(727);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 165, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(166, GraphicHeight.HIGH);
        },
        maximumHit() {
            return 19;
        },
        startGraphic() {
            return new Graphic(164, GraphicHeight.MIDDLE);
        },
        baseExperience() {
            return 40;
        },
        equipmentRequired(player) {
            return null;
        },
        itemsRequired(player) {
            return [new Item(556, 5), new Item(565, 1), new Item(557, 7)];
        },
        levelRequired() {
            return 70;
        },
        spellId() {
            return 1188;
        }
    });

    public static ENFEEBLE = new CombatEffectSpell({
        members: true,
        castAnimation: function () {
            return new Animation(729);
        },
        castProjectile: function (cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 171, 0, 20, 43, 31);
        },
        spellEffect: function (cast, castOn) {
            if (castOn.isPlayer()) {
                let player = castOn as Player;
                if (player.getSkillManager().getCurrentLevel(Skill.STRENGTH) < player.getSkillManager().getMaxLevel(Skill.STRENGTH)) {
                    if (cast.isPlayer()) {
                        (cast as Player).sendMessage("The spell has no effect because the player is already weakened.");
                    }
                    return;
                }
                let decrease = Math.floor(0.10 * (player.getSkillManager().getCurrentLevel(Skill.STRENGTH)));
                player.getSkillManager().setCurrentLevelCombat(Skill.STRENGTH, player.getSkillManager().getCurrentLevel(Skill.STRENGTH) - decrease);
                player.getSkillManager().updateSkill(Skill.STRENGTH);
                player.sendMessage("You feel slightly weakened.");
            }
            /* else if (castOn.isNpc()) {
            let npc = castOn as NPC;
            if (npc.getDefenceWeakened()[1] || npc.getStrengthWeakened()[1]) {
            if (cast.isPlayer()) {
            (cast as Player).sendMessage("The spell has no effect because the NPC is already weakened.");
            }
            return;
            }
            npc.getStrengthWeakened()[1] = true;
            } */
        },
        endGraphic: function () {
            return new Graphic(172);
        },
        startGraphic: function () {
            return new Graphic(170, 6553600);
        },
        baseExperience: function () {
            return 83;
        },
        itemsRequired: function (player) {
            return [new Item(557, 8), new Item(555, 8), new Item(566, 1)];
        },
        levelRequired: function () {
            return 73;
        },
        spellId: function () {
            return 1543;
        }
    });

    public static FIRE_WAVE = new CombatNormalSpell({
        members: true,
        castAnimation() {
            return new Animation(727);
        },


        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 156, 0, 20, 43, 31);
        },

        endGraphic() {
            return new Graphic(157, GraphicHeight.HIGH);
        },

        maximumHit() {
            return 20;
        },

        startGraphic() {
            return new Graphic(155, GraphicHeight.MIDDLE);
        },

        baseExperience() {
            return 42;
        },

        equipmentRequired(player) {
            return null;
        },

        itemsRequired(player) {
            return [new Item(556, 5), new Item(565, 1), new Item(554, 7)];
        },

        levelRequired() {
            return 75;
        },

        spellId() {
            return 1189;
        }
    });

    public static WIND_SURGE = new CombatNormalSpell({
        members: true,
        castAnimation: () => new Animation(7855),
        castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, 1456, 0, 20, 43, 31),
        endGraphic: () => new Graphic(1457, GraphicHeight.HIGH),
        maximumHit: () => 21,
        startGraphic: () => new Graphic(1455, GraphicHeight.MIDDLE),
        baseExperience: () => 44.5,
        itemsRequired: () => [new Item(556, 7), new Item(21880)],
        levelRequired: () => 81,
        spellId: () => 21876,
    });

    public static WATER_SURGE = new CombatNormalSpell({
        members: true,
        castAnimation: () => new Animation(7855),
        castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, 1459, 0, 20, 43, 31),
        endGraphic: () => new Graphic(1460, GraphicHeight.HIGH),
        maximumHit: () => 22,
        startGraphic: () => new Graphic(1458, GraphicHeight.MIDDLE),
        baseExperience: () => 46.5,
        itemsRequired: () => [new Item(556, 7), new Item(555, 10), new Item(21880)],
        levelRequired: () => 85,
        spellId: () => 21877,
    });

    public static EARTH_SURGE = new CombatNormalSpell({
        members: true,
        castAnimation: () => new Animation(7855),
        castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, 1462, 0, 20, 43, 31),
        endGraphic: () => new Graphic(1463, GraphicHeight.HIGH),
        maximumHit: () => 23,
        startGraphic: () => new Graphic(1461, GraphicHeight.MIDDLE),
        baseExperience: () => 48.5,
        itemsRequired: () => [new Item(556, 7), new Item(557, 10), new Item(21880)],
        levelRequired: () => 90,
        spellId: () => 21878,
    });

    public static FIRE_SURGE = new CombatNormalSpell({
        members: true,
        castAnimation: () => new Animation(7855),
        castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, 1465, 0, 20, 43, 31),
        endGraphic: () => new Graphic(1466, GraphicHeight.HIGH),
        maximumHit: () => 24,
        startGraphic: () => new Graphic(1464, GraphicHeight.MIDDLE),
        baseExperience: () => 50.5,
        itemsRequired: () => [new Item(556, 7), new Item(554, 10), new Item(21880)],
        levelRequired: () => 95,
        spellId: () => 21879,
    });

    public static GHOSTLY_GRASP = new CombatArceuusSpell({
        castAnimation: () => new Animation(GRASP_ANIMATION),
        castProjectile: () => null,
        endGraphic: () => null,
        maximumHit: () => 12,
        startGraphic: () => new Graphic(1856),
        baseExperience: () => 22.5,
        itemsRequired: () => [new Item(556, 4), new Item(562)],
        levelRequired: () => 35,
        spellId: () => 21826,
    }, false, { chance: 10, ticks: 2, bound: 1857, unbound: 1858 });

    public static INFERIOR_DEMONBANE = new CombatArceuusSpell({
        castAnimation: () => new Animation(DEMONBANE_ANIMATION),
        castProjectile: () => null,
        endGraphic: () => new Graphic(1866),
        maximumHit: () => 16,
        startGraphic: () => new Graphic(1865),
        baseExperience: () => 27,
        itemsRequired: () => [new Item(554, 3), new Item(566)],
        levelRequired: () => 44,
        spellId: () => 20398,
    }, true);

    public static SKELETAL_GRASP = new CombatArceuusSpell({
        castAnimation: () => new Animation(GRASP_ANIMATION),
        castProjectile: () => null,
        endGraphic: () => null,
        maximumHit: () => 17,
        startGraphic: () => new Graphic(1859),
        baseExperience: () => 33,
        itemsRequired: () => [new Item(557, 8), new Item(560)],
        levelRequired: () => 56,
        spellId: () => 21829,
    }, false, { chance: 25, ticks: 3, bound: 1860, unbound: 1861 });

    public static SUPERIOR_DEMONBANE = new CombatArceuusSpell({
        castAnimation: () => new Animation(DEMONBANE_ANIMATION),
        castProjectile: () => null,
        endGraphic: () => new Graphic(1868),
        maximumHit: () => 23,
        startGraphic: () => new Graphic(1867),
        baseExperience: () => 36,
        itemsRequired: () => [new Item(554, 5), new Item(566)],
        levelRequired: () => 62,
        spellId: () => 20399,
    }, true);

    public static UNDEAD_GRASP = new CombatArceuusSpell({
        castAnimation: () => new Animation(GRASP_ANIMATION),
        castProjectile: () => null,
        endGraphic: () => null,
        maximumHit: () => 24,
        startGraphic: () => new Graphic(1862),
        baseExperience: () => 46.5,
        itemsRequired: () => [new Item(554, 12), new Item(565)],
        levelRequired: () => 79,
        spellId: () => 21832,
    }, false, { chance: 50, ticks: 4, bound: 1863, unbound: 1864 });

    public static DARK_DEMONBANE = new CombatArceuusSpell({
        castAnimation: () => new Animation(DEMONBANE_ANIMATION),
        castProjectile: () => null,
        endGraphic: () => new Graphic(1870),
        maximumHit: () => 30,
        startGraphic: () => new Graphic(1869),
        baseExperience: () => 43.5,
        itemsRequired: () => [new Item(554, 7), new Item(566, 2)],
        levelRequired: () => 82,
        spellId: () => 20400,
    }, true);

    public static MARK_OF_DARKNESS = new CombatArceuusEffectSpell({
        castAnimation: () => new Animation(711),
        castProjectile: () => null,
        endGraphic: () => null,
        startGraphic: () => null,
        baseExperience: () => 70,
        itemsRequired: () => [new Item(566), new Item(564)],
        levelRequired: () => 59,
        spellId: () => 20392,
        spellEffect: (cast, target) => {
            if (!cast.isPlayer()) return;
            const magicLevel = cast.getAsPlayer().getSkillManager().getCurrentLevel(Skill.MAGIC);
            cast.setAttribute(ARCEUUS_MARK_UNTIL, Date.now() + magicLevel * 600);
        },
    });

    public static LESSER_CORRUPTION = new CombatArceuusEffectSpell({
        castAnimation: () => new Animation(711),
        castProjectile: () => null,
        endGraphic: () => null,
        startGraphic: () => null,
        baseExperience: () => 75,
        itemsRequired: () => [new Item(560), new Item(566, 2)],
        levelRequired: () => 64,
        spellId: () => 10511,
        spellEffect: (cast) => {
            if (cast.isPlayer()) cast.getAsPlayer().setAttribute("arceuus:corruption", 6);
        },
    });

    public static GREATER_CORRUPTION = new CombatArceuusEffectSpell({
        castAnimation: () => new Animation(711),
        castProjectile: () => null,
        endGraphic: () => null,
        startGraphic: () => null,
        baseExperience: () => 95,
        itemsRequired: () => [new Item(565), new Item(566, 3)],
        levelRequired: () => 85,
        spellId: () => 20762,
        spellEffect: (cast) => {
            if (cast.isPlayer()) cast.getAsPlayer().setAttribute("arceuus:corruption", 12);
        },
    });

    // The cache's Dark Lure animation (human_cast_vicious_strike) and graphics (cast, travel, hit).
    public static DARK_LURE = new DarkLureSpell({
        castAnimation: () => new Animation(8974),
        castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, 1883, 0, 20, 43, 31),
        endGraphic: () => new Graphic(1884, GraphicHeight.HIGH),
        startGraphic: () => new Graphic(1882),
        baseExperience: () => 60,
        itemsRequired: () => [new Item(560), new Item(561)],
        levelRequired: () => 50,
        spellId: () => 15303,
        spellEffect: (_cast, target) => {
            if (!target.isNpc()) return;
            target.getMovementQueue().reset();
            target.setAttribute("arceuus:dark-lure-until", Date.now() + 20_000);
            target.getCombat().attack(_cast);
        },
    });

    public static ENTANGLE = new CombatEffectSpell({
        members: true,
        castAnimation() {
            return new Animation(710);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 178, 0, 20, 43, 31);
        },
        spellEffect(cast, castOn) {
            getCombatFactory().freeze(castOn, 15);
        },
        endGraphic() {
            return new Graphic(179, GraphicHeight.HIGH);
        },
        startGraphic() {
            return new Graphic(177, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 91;
        },
        itemsRequired(player) {
            return [new Item(555, 5), new Item(557, 5), new Item(561, 4)];
        },
        levelRequired() {
            return 79;
        },
        spellId() {
            return 1592;
        }
    });

    public static STUN = new CombatEffectSpell({
        members: true,
        castAnimation() {
            return new Animation(729);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 174, 0, 20, 43, 31);
        },
        spellEffect(cast, castOn) {
            if (castOn.isPlayer()) {
                const player = castOn as Player;

                if (player.getSkillManager().getCurrentLevel(Skill.ATTACK) < player.getSkillManager().getMaxLevel(Skill.ATTACK)) {
                    if (cast.isPlayer()) {
                        (cast as Player).sendMessage(
                            "The spell has no effect because the player is already weakened.");
                    }
                    return;
                }

                const decrease = Math.floor(0.10 * (player.getSkillManager().getCurrentLevel(Skill.ATTACK)));
                player.getSkillManager().setCurrentLevelCombat(Skill.ATTACK, player.getSkillManager().getCurrentLevel(Skill.ATTACK) - decrease);
                player.getSkillManager().updateSkill(Skill.ATTACK);
                player.sendMessage(
                    "You feel slightly weakened.");
            }/* else if (castOn.isNpc()) {
                    const npc = castOn as NPC;
        
                    if (npc.getDefenceWeakened()[0] || npc.getStrengthWeakened()[0]) {
                        if (cast.isPlayer()) {
                            (cast as Player).sendMessage(
                                "The spell has no effect because the NPC is already weakened.");
                        }
                        return;
                    }
        
                    npc.getStrengthWeakened()[0] = true;
                }*/
        },
        endGraphic() {
            return new Graphic(107);
        },
        startGraphic() {
            return new Graphic(173, 6553600);
        },
        baseExperience() {
            return 90;
        },
        itemsRequired(player) {
            return [new Item(557, 12), new Item(555, 12), new Item(556, 1)];
        },
        levelRequired() {
            return 80;
        },
        spellId() {
            return 1562;
        }
    });

    public static TELEBLOCK = new CombatEffectSpell({
        castAnimation: function () {
            return new Animation(1819);
        },
        castProjectile: function (cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 344, 0, 20, 43, 31);
        },
        spellEffect: function (cast, castOn) {
            if (castOn.isPlayer()) {
                let player = castOn as Player;
                if (!player.getCombat().getTeleblockTimer().finished()) {
                    if (cast.isPlayer()) {
                        (cast as Player).sendMessage(
                            "The spell has no effect because the player is already teleblocked."
                        );
                    }
                    return;
                }
                // Wiki: 5 minutes, halved when Protect from Magic was already up.
                const seconds = player.getPrayerActive()[PrayerHandler.PROTECT_FROM_MAGIC] ? 150 : 300;
                player.getCombat().getTeleblockTimer().start(seconds);
                player.getPacketSender().sendEffectTimer(seconds, EffectTimer.TELE_BLOCK)
                    .sendMessage("You have just been teleblocked!");
            } else if (castOn.isNpc()) {
                if (cast.isPlayer()) {
                    (cast as Player).sendMessage("Your spell has no effect on this target.");
                }
            }
        },
        endGraphic: function () {
            return new Graphic(345);
        },
        startGraphic: function () {
            return null;
        },
        baseExperience: function () {
            return 65;
        },
        itemsRequired: function (player) {
            return [new Item(563, 1), new Item(562, 1), new Item(560, 1)];
        },
        levelRequired: function () {
            return 85;
        },
        spellId: function () {
            return 12445;
        }
    });

    public static SMOKE_RUSH = new CombatAncientSpellExtend(
        () => { return new Animation(1978); },
        () => { return null; },
        (cast: Mobile, castOn: Mobile, damage: number) => { if (Misc.getRandom(7) === 0) { getCombatFactory().poisonEntity(castOn, 10); } },
        () => { return 0; },
        (cast: Mobile, castOn: Mobile) => { return Projectile.createProjectile(cast, castOn, 384, 0, 20, 43, 31); },
        () => { return new Graphic(385); },
        () => { return 13; },
        () => { return 30; },
        () => { return [new Item(556, 1), new Item(554, 1), new Item(562, 2), new Item(560, 2)]; },
        () => { return 50; },
        () => { return 12939; }
    )

    public static SHADOW_RUSH = new CombatAncientSpellExtend(
        () => { return new Animation(1978); },
        () => { },
        (cast: Mobile, castOn: Mobile, damage: number) => {
            if (castOn.isPlayer()) {
                const player = castOn as Player;
                if (player.getSkillManager().getCurrentLevel(Skill.ATTACK) < player.getSkillManager().getMaxLevel(Skill.ATTACK)) {
                    return;
                }
                const decrease = Math.floor(0.1 * (player.getSkillManager().getCurrentLevel(Skill.ATTACK)));
                player.getSkillManager().setCurrentLevelCombat(Skill.ATTACK, player.getSkillManager().getCurrentLevel(Skill.ATTACK) - decrease);
                player.getSkillManager().updateSkill(Skill.ATTACK);
            }
        },
        () => { return 0; },
        (cast: Mobile, castOn: Mobile) => { return Projectile.createProjectile(cast, castOn, 378, 0, 20, 43, 31); },
        () => { return new Graphic(379); },
        () => { return 14; },
        () => { return 31; },
        () => { return [new Item(556, 1), new Item(566, 1), new Item(562, 2), new Item(560, 2)]; },
        () => { return 52; },
        () => { return 12987; }

    )
    spellEffectOnHitCalc(cast, damage: number) {
        cast.heal(Math.floor(damage * 0.10));
    }

    public static BLOOD_RUSH = new CombatAncientSpellExtend(
        () => { return new Animation(1978); },
        () => { },
        (cast: Mobile, castOn: Mobile, damage: number) => { cast.heal(Math.floor(damage * 0.10)); },
        () => { return 0; },
        (cast: Mobile, castOn: Mobile) => { return Projectile.createProjectile(cast, castOn, 372, 0, 20, 43, 31); },
        () => { return new Graphic(373); },
        () => { return 15; },
        () => { return 33; },
        () => {
            return [
                new Item(565, 1),
                new Item(562, 2),
                new Item(560, 2),
            ];
        },
        () => { return 56; },
        () => { return 12901; }

    )

    public static ICE_RUSH = new CombatAncientSpellExtend(
        () => { return new Animation(1978); },
        () => { },
        (cast: Mobile, castOn: Mobile, damage: number) => { getCombatFactory().freeze(castOn, 5); },
        () => { return 0; },
        (cast: Mobile, castOn: Mobile) => { return Projectile.createProjectile(cast, castOn, 360, 0, 20, 43, 31); },
        () => { return new Graphic(361); },
        () => { return 18; },
        () => { return 34; },
        () => {
            return [
                new Item(555, 2),
                new Item(562, 2),
                new Item(560, 2),
            ];
        },
        () => { return 58; },
        () => { return 12861; }
    )

    public static SMOKE_BURST = new CombatAncientSpellExtend(
        () => { return new Animation(1979); },
        () => { },
        (cast: Mobile, castOn: Mobile, damage: number) => { if (Misc.getRandom(7) === 0) { getCombatFactory().poisonEntity(castOn, 10); } },
        () => { return 1; },
        () => { return null; },
        () => { return new Graphic(389); },
        () => { return 13; },
        () => { return 36; },
        () => { return [new Item(556, 2), new Item(554, 2), new Item(562, 4), new Item(560, 2)]; },
        () => { return 62; },
        () => { return 12963; }

    );

    public static SHADOW_BURST = new CombatAncientSpellExtend(
        () => { return new Animation(1979); },
        () => { return null; },
        (cast: Mobile, castOn: Mobile, damage: number) => {
            if (castOn.isPlayer()) {
                const player = castOn as Player;


                if (player.getSkillManager().getCurrentLevel(Skill.ATTACK) < player.getSkillManager().getMaxLevel(Skill.ATTACK)) {
                    return;
                }

                const decrease = Math.floor(0.1 * player.getSkillManager().getCurrentLevel(Skill.ATTACK));
                player.getSkillManager().setCurrentLevelCombat(Skill.ATTACK, player.getSkillManager().getCurrentLevel(Skill.ATTACK) - decrease);
                player.getSkillManager().updateSkill(Skill.ATTACK);
            }
        },
        () => { return 1; },
        () => { return null; },
        () => { return new Graphic(382); },
        () => { return 18; },
        () => { return 37; },
        () => { return [new Item(556, 1), new Item(566, 2), new Item(562, 4), new Item(560, 2)]; },
        () => { return 64; },
        () => { return 13011; }


    )

    public static BLOOD_BURST = new CombatAncientSpellExtend(
        () => { return new Animation(1979); },
        () => { return null; },
        (cast: Mobile, castOn: Mobile, damage: number) => { cast.heal(Math.floor(damage * 0.15)); },
        () => { return 1; },
        () => { return null; },
        () => { return new Graphic(376); },
        () => { return 21; },
        () => { return 39; },
        () => { return [new Item(565, 2), new Item(562, 4), new Item(560, 2)]; },
        () => { return 68; },
        () => { return 12919; }
    )


    public static ICE_BURST = new CombatAncientSpellExtend(

        () => { return new Animation(1979); },
        () => { },
        (cast: Mobile, castOn: Mobile, damage: number) => { getCombatFactory().freeze(castOn, 10); },
        () => { return 1; },
        () => { return null; },
        () => { return new Graphic(363) },
        () => { return 22; },
        () => { return 40; },
        () => {
            return [
                new Item(555, 4),
                new Item(562, 4),
                new Item(560, 2),
            ]
        },
        () => { return 70; },
        () => { return 12881; }

    )

    public static SMOKE_BLITZ = new CombatAncientSpellExtend(

        () => { return new Animation(1978); },
        () => { return null; },
        (cast: Mobile, castOn: Mobile, damage: number) => { if (Misc.getRandom(7) === 0) { getCombatFactory().poisonEntity(castOn, 20); } },
        () => { return 0; },
        (cast: Mobile, castOn: Mobile) => { return Projectile.createProjectile(cast, castOn, 386, 0, 20, 43, 31); },
        () => { return new Graphic(387) },
        () => { return 23; },
        () => { return 42; },
        () => { return [new Item(556, 2), new Item(554, 2), new Item(565, 2), new Item(560, 2)]; },
        () => { return 74; },
        () => { return 12951; }

    )

    public static SHADOW_BLITZ = new CombatAncientSpellExtend(

        () => { return new Animation(1978); },
        () => { return null; },
        (cast: Mobile, castOn: Mobile, damage: number) => {
            if (castOn.isPlayer()) {
                const player = castOn as Player;

                if (player.getSkillManager().getCurrentLevel(Skill.ATTACK) < player.getSkillManager().getMaxLevel(Skill.ATTACK)) {
                    return;
                }

                const decrease = Math.floor(0.15 * (player.getSkillManager().getCurrentLevel(Skill.ATTACK)));
                player.getSkillManager().setCurrentLevelCombat(Skill.ATTACK, player.getSkillManager().getCurrentLevel(Skill.ATTACK) - decrease);
                player.getSkillManager().updateSkill(Skill.ATTACK);
            }
        },
        () => { return 0; },
        (cast: Mobile, castOn: Mobile) => { return Projectile.createProjectile(cast, castOn, 380, 0, 20, 43, 31); },
        () => { return new Graphic(381) },
        () => { return 24; },
        () => { return 43; },
        () => { return [new Item(556, 2), new Item(566, 2), new Item(565, 2), new Item(560, 2)]; },
        () => { return 76; },
        () => { return 12999; }

    )

    public static BLOOD_BLITZ = new CombatAncientSpellExtend(

        () => { return new Animation(1978); },
        () => { return null; },
        (cast: Mobile, castOn: Mobile, damage: number) => { cast.heal(Math.floor(damage * 0.20)); },
        () => { return 0; },
        (cast: Mobile, castOn: Mobile) => { return Projectile.createProjectile(cast, castOn, 374, 0, 20, 43, 31); },
        () => { return new Graphic(375) },
        () => { return 25; },
        () => { return 45; },
        () => { return [new Item(565, 4), new Item(560, 2)]; },
        () => { return 80; },
        () => { return 12911; }

    )

    public static ICE_BLITZ = new CombatAncientSpellExtend(

        () => { return new Animation(1978); },
        () => { return new Graphic(366, 6553600); },
        (cast: Mobile, castOn: Mobile, damage: number) => { getCombatFactory().freeze(castOn, 15); },
        () => { return 0; },
        (cast: Mobile, castOn: Mobile) => { return null; },
        () => { return new Graphic(367) },
        () => { return 26; },
        () => { return 46; },
        () => { return [new Item(555, 3), new Item(565, 2), new Item(560, 2)]; },
        () => { return 82; },
        () => { return 12871; }

    )

    public static SMOKE_BARRAGE = new CombatAncientSpellExtend(

        () => { return new Animation(1979); },
        () => { return null; },
        (cast: Mobile, castOn: Mobile, damage: number) => { if (Misc.getRandom(7) === 0) { getCombatFactory().poisonEntity(castOn, 20); } },
        () => { return 1; },
        (cast: Mobile, castOn: Mobile) => { return null; },
        () => { return new Graphic(391) },
        () => { return 27; },
        () => { return 48; },
        () => { return [new Item(556, 4), new Item(554, 4), new Item(565, 2), new Item(560, 4)]; },
        () => { return 86; },
        () => { return 12975; }

    )

    public static SHADOW_BARRAGE = new CombatAncientSpellExtend(

        () => { return new Animation(1979); },
        () => { return null; },
        (cast: Mobile, castOn: Mobile, damage: number) => {
            if (castOn.isPlayer()) {
                const player: Player = castOn as Player;


                if (player.getSkillManager().getCurrentLevel(Skill.ATTACK) < player.getSkillManager().getMaxLevel(Skill.ATTACK)) {
                    return;
                }

                const decrease: number = Math.floor(0.15 * (player.getSkillManager().getCurrentLevel(Skill.ATTACK)));
                player.getSkillManager().setCurrentLevelCombat(Skill.ATTACK, player.getSkillManager().getCurrentLevel(Skill.ATTACK) - decrease);
                player.getSkillManager().updateSkill(Skill.ATTACK);
            }
        },
        () => { return 1; },
        (cast: Mobile, castOn: Mobile) => { return null; },
        () => { return new Graphic(383) },
        () => { return 28; },
        () => { return 49; },
        () => { return [new Item(556, 4), new Item(566, 3), new Item(565, 2), new Item(560, 4)]; },
        () => { return 88; },
        () => { return 13023; }

    )

    public static BLOOD_BARRAGE = new CombatAncientSpellExtend(

        () => { return new Animation(1979); },
        () => { return null; },
        (cast: Mobile, castOn: Mobile, damage: number) => { cast.heal(Math.floor(damage * 0.20)); },
        () => { return 1; },
        (cast: Mobile, castOn: Mobile) => { return null; },
        () => { return new Graphic(377) },
        () => { return 29; },
        () => { return 51; },
        () => { return [new Item(560, 4), new Item(566, 1), new Item(565, 4)]; },
        () => { return 92; },
        () => { return 12929; }


    )

    public static ICE_BARRAGE = new CombatAncientSpellExtend(

        () => { return new Animation(1979); },
        () => { return null; },
        (cast: Mobile, castOn: Mobile, damage: number) => { getCombatFactory().freeze(castOn, 20); },
        () => { return 1; },
        (cast: Mobile, castOn: Mobile) => { return null; },
        () => { return new Graphic(369) },
        () => { return 30; },
        () => { return 52; },
        () => { return [new Item(555, 6), new Item(565, 2), new Item(560, 4)]; },
        () => { return 94; },
        () => { return 12891; },
        () => { return Sound.ICA_BARRAGE_IMPACT; }

    )
    public static TRIDENT_OF_THE_SEAS = new TridentSpell({
        castAnimation(): Animation {
            return new Animation(1167);
        },

        castProjectile(cast: Mobile, castOn: Mobile): Projectile {
            return Projectile.createProjectile(cast, castOn, 1252, 0, 20, 43, 31);
        },

        endGraphic(): Graphic {
            return new Graphic(1253);
        },

        maximumHit(): number {
            return 20;
        },

        startGraphic(): Graphic {
            return new Graphic(1251, GraphicHeight.HIGH);
        },

        baseExperience(): number {
            return 50;
        },

        equipmentRequired(player: Player): Item[] {
            return null;
        },

        itemsRequired(player: Player): Item[] {
            return null;
        },

        levelRequired(): number {
            return 75;
        },

        spellId(): number {
            return 1;
        }
    }, ItemIdentifiers.TRIDENT_OF_THE_SEAS, ItemIdentifiers.UNCHARGED_TRIDENT);

    public static TRIDENT_OF_THE_SWAMP = new TridentSpell({
        castAnimation(): Animation {
            return new Animation(1167);
        },

        castProjectile(cast: Mobile, castOn: Mobile): Projectile {
            return Projectile.createProjectile(cast, castOn, 1040, 0, 20, 43, 31);
        },

        endGraphic(): Graphic {
            return new Graphic(1042);
        },

        maximumHit(): number {
            return 20;
        },

        startGraphic(): Graphic {
            return new Graphic(665, GraphicHeight.HIGH);
        },

        baseExperience(): number {
            return 50;
        },

        equipmentRequired(player: Player): Item[] {
            return null;
        },

        itemsRequired(player: Player): Item[] {
            return null;
        },

        levelRequired(): number {
            return 75;
        },

        spellId(): number {
            return 1;
        }
    }, ItemIdentifiers.TRIDENT_OF_THE_SWAMP, ItemIdentifiers.UNCHARGED_TOXIC_TRIDENT);

    /**

The spell attached to this element.
*/
    private readonly spell: CombatSpell;
    /**
    
    Creates a new {@link CombatSpells}.
    @param spell
           the spell attached to this element.
    */
    private constructor(spell: CombatSpell) {
        this.spell = spell;
    }

    /**
    
    Gets the spell attached to this element.
    @return the spell.
    */
    public getSpell(): CombatSpell {
        return this.spell;
    }

    /**

Gets the spell with a {@link CombatSpell#spellId()} of {@code id}.
@param id
       the identification of the combat spell.
@return the combat spell with that identification.
*/
    public static getCombatSpells(id: number): CombatSpell | null {
        if (!Number.isInteger(id) || id <= 0) {
            return null;
        }

        const values = Object.values(CombatSpells) as any[];
        for (const value of values) {
            if (!value) {
                continue;
            }
            const maybeSpell =
                typeof value.spellId === "function"
                    ? value
                    : typeof value.getSpell === "function"
                      ? value.getSpell()
                      : null;
            if (!maybeSpell || typeof maybeSpell.spellId !== "function") {
                continue;
            }
            if (maybeSpell.spellId() === id) {
                return maybeSpell as CombatSpell;
            }
        }
        return null;
    }



    public static getCombatSpell(spellId: number): CombatSpell | null {
        return CombatSpells.getCombatSpells(spellId);
    }

    public static getCombatSpellByName(name: string): CombatSpell | null {
        const normalized = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
        for (const [property, value] of Object.entries(CombatSpells) as Array<[string, any]>) {
            if (property.replace(/_/g, "") !== normalized) continue;
            const spell = typeof value?.spellId === "function" ? value : value?.getSpell?.();
            return spell && typeof spell.spellId === "function" ? spell as CombatSpell : null;
        }
        return null;
    }


}
