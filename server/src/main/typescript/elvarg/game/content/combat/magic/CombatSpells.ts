
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
import { ItemAliases } from "../../../model/ItemAliases";
import { Equipment } from "../../../model/container/impl/Equipment";
import { PrayerHandler } from "../../PrayerHandler";
import { TeleBlock } from "./TeleBlock";
import { CombatEffectSpell } from "./CombatEffectSpell";
import { CombatNormalSpell, CombatNormalSpellOptions } from "./CombatNormalSpell";
import { CombatSpell } from "./CombatSpell";
import { Spell } from "./Spell";
import { World } from "../../../World";
import { PluginManager } from "../../../../plugins/PluginManager";

class ChargeSpell extends Spell {
    spellId(): number { return 0; }
    levelRequired(): number { return 80; }
    baseExperience(): number { return 180; }
    itemsRequired(): Item[] { return [new Item(556, 3), new Item(554, 3), new Item(565, 3)]; }
    equipmentRequired(): Item[] { return []; }
    startCast(): void { }

    /** Wiki (Charge): members only. */
    public members = true;

    /** Wiki (Charge): it can only be cast once every 60 seconds (100 ticks). */
    protected getCastCooldown(): { attribute: string, duration: number } | null {
        return { attribute: CombatSpells.CHARGE_NEXT_CAST, duration: 60_000 };
    }

    cast(player: Player): boolean {
        // Wiki (Charge): it needs the Mage Arena I miniquest, which ends with the statues' god cape (the Mage Arena
        // plugin answers "mage-arena:cape-received"). Refused before the runes; TSPS wording for the line.
        const arena = { player, received: null as boolean | null };
        PluginManager.emitCustomEvent("mage-arena:cape-received", arena);
        if (arena.received !== true) {
            // A league relic may lift every spell's quest requirement (Wiki: Grimoire), as for Dream Mentor's spells.
            const unlock = { player, name: "charge", unlocked: false };
            PluginManager.emitCustomEvent("magic:spell-unlocked", unlock);
            if (unlock.unlocked !== true) {
                player.sendMessage("You need to complete the Mage Arena to cast this spell.");
                return true;
            }
        }
        // The cooldown is checked before the runes are taken, so a refused cast costs nothing.
        if (!this.canCast(player, false) || !this.canCast(player, true)) {
            return true;
        }
        player.getSkillManager().addExperiences(Skill.MAGIC, this.baseExperience());
        const until = World.getProcessCycle() + CombatSpells.CHARGE_TICKS;
        player.setAttribute(CombatSpells.CHARGE_UNTIL, until);
        // rsprox_transcripts/235/03344.txt tick 5704: the red line, human_casting (811), teleport_casting
        // (111) at delay 32 and height 128, and synth sound 1651.
        player.sendMessage("<col=ef1020>You feel charged with magic power.</col>");
        player.performAnimation(new Animation(811));
        player.performGraphic(new Graphic(111, 32, 128 as GraphicHeight));
        player.getPacketSender().sendSoundEffect(1651, 1, 0, 255);
        // The plugin that says "Your magical charge fades away" schedules itself from this.
        PluginManager.emitCustomEvent("magic:charge-cast", { player, until });
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
        return scaledDemonbane(caster, wieldsPurgingStaff(caster) ? 1.5 : 1.25);
    }

    public demonbaneAccuracyMultiplier(caster: Mobile | null): number {
        if (!this.demonbane || !caster?.isPlayer()) return 1;
        if (!hasArceuusMark(caster)) return scaledDemonbane(caster, 1.2);
        return scaledDemonbane(caster, wieldsPurgingStaff(caster) ? 1.8 : 1.4);
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
            // rsprox_transcripts/241/900056.txt tick 131: Superior Demonbane on a man.
            cast.getAsPlayer().sendMessage("This spell only affects demons.");
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

const TELE_BLOCK_HIT = 1299;
const TELE_BLOCK_FAIL = 1300;

/**
 * Tele Block's projectile shows whether it lands (Wiki: since 25 February 2016): teleport_reverse, a
 * purple sphere, when it hits, as in rsprox captures, and the old tele_block_travel_forfail when it
 * fails. The hit is rolled after the cast starts, so the projectile goes out with the roll, that tick.
 */
class TeleBlockSpell extends CombatEffectSpell {
    public castProjectile(): Projectile {
        return null;
    }

    public onHitCalc(hit: PendingHit): void {
        super.onHitCalc(hit);
        const projectile = hit.isAccurate() ? TELE_BLOCK_HIT : TELE_BLOCK_FAIL;
        Projectile.createProjectile(hit.getAttacker(), hit.getTarget(), projectile, 0, 20, 43, 31).sendProjectile();
    }
}

const ARCEUUS_MARK_UNTIL = "arceuus:mark-until";

const hasArceuusMark = (target: Mobile): boolean =>
    Number(target.getAttribute(ARCEUUS_MARK_UNTIL) ?? 0) > World.getProcessCycle();
const hasArceuusWard = (target: Mobile): boolean =>
    Number(target.getAttribute("arceuus:ward-until") ?? 0) > World.getProcessCycle();
/**
 * A demon's demonbane vulnerability other than 100% (Wiki: Yama 120%, his void flares 200%), set by
 * the content that spawns it on the NPC's DEMONBANE_VULNERABILITY_ATTRIBUTE: the bonus scales with it.
 */
export const DEMONBANE_VULNERABILITY_ATTRIBUTE = "combat:demonbane-vulnerability";

function scaledDemonbane(caster: Mobile, multiplier: number): number {
    const target: any = (caster as any).getCombat?.()?.getTarget?.();
    const vulnerability = Number(target?.getAttribute?.(DEMONBANE_VULNERABILITY_ATTRIBUTE));
    return vulnerability > 0 ? 1 + (multiplier - 1) * vulnerability : multiplier;
}

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

    public spellEffectOnHitCalc(cast: Mobile, castOn: Mobile, damage: number, effectMultiplier = 1): void {
        this.spellEffectOnHitCalcFunction(cast, castOn, damage, effectMultiplier);
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



/**
 * The staves that cast each god spell (Wiki: Saradomin Strike, Claws of Guthix, Flames of Zamorak): the god staff and
 * the bladed staff of the same god, and for Flames the charged revenant sceptres too.
 */
const SARADOMIN_STRIKE_STAVES = new Set([ItemIdentifiers.SARADOMIN_STAFF, ItemIdentifiers.STAFF_OF_LIGHT]);
/** Wiki (Claws of Guthix): a Guthix staff, the void knight mace or the staff of balance. */
const CLAWS_OF_GUTHIX_STAVES = new Set([ItemIdentifiers.GUTHIX_STAFF, ItemIdentifiers.VOID_KNIGHT_MACE,
    ItemIdentifiers.VOID_KNIGHT_MACE_L_, ItemIdentifiers.STAFF_OF_BALANCE]);
const IBAN_BLAST_STAVES = new Set([
    ItemIdentifiers.IBANS_STAFF, ItemIdentifiers.IBANS_STAFF_U_, ItemIdentifiers.IBANS_STAFF_O_, ItemIdentifiers.IBANS_STAFF_U_O_,
]);
const FLAMES_OF_ZAMORAK_STAVES = new Set([
    ItemIdentifiers.ZAMORAK_STAFF, ItemIdentifiers.STAFF_OF_THE_DEAD, 12902, ItemIdentifiers.TOXIC_STAFF_OF_THE_DEAD,
    ItemIdentifiers.THAMMARONS_SCEPTRE_A_, ItemIdentifiers.ACCURSED_SCEPTRE_A_,
]);

/**
 * Wiki (Claws of Guthix, Flames of Zamorak): a hit lowers Defence or Magic by 1 + 5%; it neither
 * stacks nor reapplies until the stat is back to its base level (a boosted stat is drained too).
 * A player's cast only: the Mage Arena's battle mages cast the same spells and drain nothing
 * (rsprox_transcripts/238/04155.txt: a guthix_mage's Claws lands at ticks 1865, 1877 and 1889 with no
 * Defence update).
 */
function godSpellDrain(cast: Mobile, castOn: Mobile, skill: Skill): void {
    if (!cast.isPlayer()) return;
    if (castOn.isNpc()) {
        const npc = castOn.getAsNpc();
        const current = npc.getCurrentLevel(skill);
        if (current < npc.getMaxLevel(skill)) return;
        npc.setCurrentLevels(skill, Math.max(0, current - (1 + Math.floor(current * 0.05))));
    } else if (castOn.isPlayer()) {
        const skills = castOn.getAsPlayer().getSkillManager();
        const current = skills.getCurrentLevel(skill);
        if (current < skills.getMaxLevel(skill)) return;
        // setCurrentLevelCombat sends the stat itself.
        skills.setCurrentLevelCombat(skill, Math.max(0, current - (1 + Math.floor(current * 0.05))));
    }
}

/** Wiki (Saradomin Strike): a player's hit lowers the target's Prayer points by 1; most NPCs have none. */
function saradominStrikeDrain(cast: Mobile, castOn: Mobile): void {
    if (!cast.isPlayer() || !castOn.isPlayer()) return;
    const skills = castOn.getAsPlayer().getSkillManager();
    const current = skills.getCurrentLevel(Skill.PRAYER);
    if (current <= 0) return;
    skills.setCurrentLevelCombat(Skill.PRAYER, current - 1);
}

/**
 * Wiki (Shadow spells): a hit lowers the target's Attack by 10% (rush, burst) or 15% (blitz, barrage),
 * players and monsters alike, unless it is already lowered; an Ancient sceptre's x1.1 arrives as `multiplier`.
 * The player branch is each spell's own; this is the NPC one.
 */
function shadowDrainNpc(castOn: Mobile, percent: number, multiplier: number): void {
    if (castOn.isPlayer()) return;
    const npc = castOn.getAsNpc?.();
    if (!npc) return;
    const level = npc.getCurrentLevel(Skill.ATTACK);
    if (level < npc.getMaxLevel(Skill.ATTACK)) return;
    npc.setCurrentLevels(Skill.ATTACK, level - Math.floor(level * percent * multiplier));
}

/** The wielded staff when it is one of `staves`, else the god staff (the first), which the cast then reports missing. */
function godStaffRequired(player: Player, staves: Set<number>): Item[] {
    const weaponId = player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId() ?? -1;
    // A minigame copy (Last Man Standing's br_sotd) casts as the staff it copies.
    const wields = staves.has(weaponId) || staves.has(ItemAliases.baseOf(weaponId) ?? -1);
    return [new Item(wields ? weaponId : staves.values().next().value as number)];
}

export class CombatSpells {
    public static readonly CHARGE_UNTIL = "charge:until";
    public static readonly CHARGE_NEXT_CAST = "charge:next-cast";
    /** Wiki (Charge): the effect lasts 700 game ticks. */
    public static readonly CHARGE_TICKS = 700;
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
        if (!caster.isPlayer() || Number(caster.getAttribute(this.CHARGE_UNTIL) ?? 0) <= World.getProcessCycle()) {
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
            return 5.5;
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
        maximumHit: () => 0,
        castAnimation() {
            return new Animation(716);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 103, 0, 20, 43, 31);
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
            return 7.5;
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
            return 9.5;
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
        maximumHit: () => 0,
        castAnimation() {
            return new Animation(717);
        },

        castProjectile(cast: Mobile, castOn: Mobile) {
            return Projectile.createProjectile(cast, castOn, 106, 0, 20, 43, 31);
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
            return 11.5;
        },

        equipmentRequired(player) {
            return null;
        },

        itemsRequired(player) {
            return [new Item(556, 2), new Item(558, 1), new Item(554, 3)];
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
            return 13.5;
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
        maximumHit: () => 0,
        castAnimation() {
            return new Animation(718);
        },

        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 109, 0, 20, 43, 31);
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
        maximumHit: () => 0,
        castAnimation: () => {
            return new Animation(710);
        },

        castProjectile: (cast, castOn) => {
            return Projectile.createProjectile(cast, castOn, 178, 0, 20, 43, 31);
        },

        endGraphic: () => {
            return new Graphic(181, GraphicHeight.HIGH);
        },

        startGraphic: () => {
            return new Graphic(177, GraphicHeight.HIGH);
        },

        baseExperience: () => {
            return 31;
        },
        splashExperience: () => 30,

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
            return 16.5;
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
            return 19.5;
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
            return 22.5;
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
        /**
         * Wiki (Crumble Undead): it can only be cast on undead enemies; anything else gets this line.
         * A scripted, unattackable target (Enakhra's Lament's boneguard) is left to its quest's handler.
         */
        canCastOnTarget(cast, target) {
            const definition = target.isNpc() ? target.getAsNpc().getCurrentDefinition() : null;
            if (definition && (definition.isUndead?.() || !definition.isAttackable?.())) return true;
            if (cast.isPlayer()) {
                cast.getAsPlayer().sendMessage("This spell only affects skeletons, zombies, ghosts and shades.");
            }
            return false;
        },
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
            return new Graphic(145, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 24.5;
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
            return 25.5;
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
            return 28.5;
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
            return new Graphic(87, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 30;
        },
        equipmentRequired(player) {
            const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
            // Wiki (Iban's staff): the upgraded and ornamented staves cast it too.
            return IBAN_BLAST_STAVES.has(weapon?.getId() ?? -1)
                ? [new Item(weapon.getId())]
                : [new Item(ItemIdentifiers.IBANS_STAFF)];
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
        maximumHit: () => 2,
        castAnimation() {
            return new Animation(710);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 178, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(180, GraphicHeight.HIGH);
        },
        startGraphic() {
            return new Graphic(177, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 61;
        },
        splashExperience: () => 60,
        itemsRequired(player) {
            return [new Item(555, 4), new Item(557, 4), new Item(561, 3)];
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
            return 10; // Magic / 10 and the Slayer's staff (e) are added by plugins/items/SlayersStaff.plugin.js.
        },
        startGraphic() {
            return null; // None live; 327 is the Slayer salt sprinkle.
        },
        baseExperience() {
            return 30;
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
            return 31.5;
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
            return 34.5;
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
        finishCast: (cast: Mobile, castOn: Mobile) => saradominStrikeDrain(cast, castOn),
        // rsprox_transcripts/235/03344.txt tick 4503.
        missingEquipmentMessage: "You must be wielding the Staff of Saradomin or the Staff of Light to cast this spell.",
        equipmentRequired: (player: Player) => godStaffRequired(player, SARADOMIN_STRIKE_STAVES),
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
        finishCast: (cast: Mobile, castOn: Mobile) => godSpellDrain(cast, castOn, Skill.DEFENCE),
        equipmentRequired: (player: Player): Item[] => godStaffRequired(player, CLAWS_OF_GUTHIX_STAVES),
        itemsRequired: (player: Player): Item[] => {
            return [new Item(556, 4), new Item(565, 2), new Item(554, 1)];
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
        finishCast: (cast: Mobile, castOn: Mobile) => godSpellDrain(cast, castOn, Skill.MAGIC),
        // rsprox_transcripts/235/03344.txt tick 5691.
        missingEquipmentMessage: "You must be wielding the Staff of Zamorak, Staff of the Dead, Thammaron's Sceptre, or the Accursed Sceptre to cast this spell.",
        equipmentRequired: (player: Player): Item[] => godStaffRequired(player, FLAMES_OF_ZAMORAK_STAVES),
        itemsRequired: (player: Player): Item[] => {
            return [new Item(556, 1), new Item(565, 2), new Item(554, 4)];
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
            return new Graphic(158, GraphicHeight.HIGH);
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
            return new Graphic(161, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 37.5;
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
        maximumHit: () => 0,
        members: true,
        castAnimation() {
            return new Animation(718);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 168, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(169);
        },
        startGraphic() {
            return new Graphic(167, GraphicHeight.HIGH);
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
            return new Graphic(164, GraphicHeight.HIGH);
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
        maximumHit: () => 0,
        members: true,
        castAnimation: function () {
            return new Animation(728);
        },
        castProjectile: function (cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 171, 0, 20, 43, 31);
        },
        endGraphic: function () {
            return new Graphic(172);
        },
        startGraphic: function () {
            return new Graphic(170, GraphicHeight.HIGH);
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
            return new Graphic(155, GraphicHeight.HIGH);
        },

        baseExperience() {
            return 42.5;
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
        startGraphic: () => new Graphic(1455, GraphicHeight.SURGE_CAST),
        baseExperience: () => 44.5,
        itemsRequired: () => [new Item(556, 7), new Item(21880)],
        levelRequired: () => 81,
        spellId: () => 21876,
    });

    public static WATER_SURGE = new CombatNormalSpell({
        members: true,
        castAnimation: () => new Animation(7855),
        castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, 1459, 0, 20, 43, 31),
        endGraphic: () => new Graphic(1460, GraphicHeight.SURGE_IMPACT),
        maximumHit: () => 22,
        startGraphic: () => new Graphic(1458, GraphicHeight.SURGE_CAST),
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
        startGraphic: () => new Graphic(1461, GraphicHeight.SURGE_CAST),
        baseExperience: () => 48.2,
        itemsRequired: () => [new Item(556, 7), new Item(557, 10), new Item(21880)],
        levelRequired: () => 90,
        spellId: () => 21878,
    });

    public static FIRE_SURGE = new CombatNormalSpell({
        members: true,
        castAnimation: () => new Animation(7855),
        castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, 1465, 0, 20, 43, 31),
        endGraphic: () => new Graphic(1466, GraphicHeight.SURGE_IMPACT),
        maximumHit: () => 24,
        startGraphic: () => new Graphic(1464, GraphicHeight.SURGE_CAST),
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
        itemsRequired: () => [new Item(554, 3), new Item(562)],
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
            cast.setAttribute(ARCEUUS_MARK_UNTIL, World.getProcessCycle() + magicLevel);
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
            // Wiki (Dark Lure): it "remains active on monsters for 61.2 seconds", 102 ticks.
            target.setAttribute("arceuus:dark-lure-until", World.getProcessCycle() + 102);
            target.getCombat().attack(_cast);
        },
    });

    public static ENTANGLE = new CombatEffectSpell({
        maximumHit: () => 5,
        members: true,
        castAnimation() {
            return new Animation(710);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 178, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(179, GraphicHeight.HIGH);
        },
        startGraphic() {
            return new Graphic(177, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 89;
        },
        splashExperience: () => 70,
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
        maximumHit: () => 0,
        members: true,
        castAnimation() {
            return new Animation(729);
        },
        castProjectile(cast, castOn) {
            return Projectile.createProjectile(cast, castOn, 174, 0, 20, 43, 31);
        },
        endGraphic() {
            return new Graphic(80, GraphicHeight.HIGH); // Live, a Stun that lands shows stunned; 107 is Weaken's impact.
        },
        startGraphic() {
            return new Graphic(173, GraphicHeight.HIGH);
        },
        baseExperience() {
            return 90;
        },
        itemsRequired(player) {
            return [new Item(557, 12), new Item(555, 12), new Item(566, 1)];
        },
        levelRequired() {
            return 80;
        },
        spellId() {
            return 1562;
        }
    });

    public static TELEBLOCK = new TeleBlockSpell({
        // Wiki: Tele Block deals no damage; without a declared maximum a player's cast defaults to 1.
        maximumHit: () => 0,
        castAnimation: function () {
            return new Animation(1819);
        },
        // TeleBlockSpell sends it once the hit is rolled; 344 was the ballista special.
        castProjectile: () => null,
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
                TeleBlock.apply(player, cast.isPlayer() ? (cast as Player).getUsername() : "a monster");
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
        // OSRS update of 2 March 2017: 95 on a successful cast, 84 on a failed one.
        baseExperience: function () {
            return 95;
        },
        splashExperience: () => 84,
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

    // Base effects: https://oldschool.runescape.wiki/w/Ancient_Magicks#Combat_spells
    // Ice durations are ticks, rounded down after modifiers: https://oldschool.runescape.wiki/w/Ice_spells
    public static SMOKE_RUSH = new CombatAncientSpellExtend(
        () => { return new Animation(1978); },
        () => { return null; },
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => { if (Misc.getRandom(7) === 0) { getCombatFactory().poisonEntity(castOn, Math.floor(10 * multiplier)); } },
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
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => {
            shadowDrainNpc(castOn, 0.1, multiplier);
            if (castOn.isPlayer()) {
                const player = castOn as Player;
                if (player.getSkillManager().getCurrentLevel(Skill.ATTACK) < player.getSkillManager().getMaxLevel(Skill.ATTACK)) {
                    return;
                }
                const decrease = Math.floor(0.1 * multiplier * (player.getSkillManager().getCurrentLevel(Skill.ATTACK)));
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
        cast.heal(Math.floor(damage * 0.25));
    }

    public static BLOOD_RUSH = new CombatAncientSpellExtend(
        () => { return new Animation(1978); },
        () => { },
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => { cast.heal(Math.floor(damage * (0.25 * multiplier))); },
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
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => { getCombatFactory().freezeTicks(castOn, Math.floor(8 * multiplier), null, cast, "ice"); },
        () => { return 0; },
        (cast: Mobile, castOn: Mobile) => { return Projectile.createProjectile(cast, castOn, 360, 0, 20, 43, 31); },
        () => { return new Graphic(361); },
        () => { return 16; },
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
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => { if (Misc.getRandom(7) === 0) { getCombatFactory().poisonEntity(castOn, Math.floor(10 * multiplier)); } },
        () => { return 1; },
        () => { return null; },
        () => { return new Graphic(389); },
        () => { return 17; },
        () => { return 36; },
        () => { return [new Item(556, 2), new Item(554, 2), new Item(562, 4), new Item(560, 2)]; },
        () => { return 62; },
        () => { return 12963; }

    );

    public static SHADOW_BURST = new CombatAncientSpellExtend(
        () => { return new Animation(1979); },
        () => { return null; },
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => {
            shadowDrainNpc(castOn, 0.1, multiplier);
            if (castOn.isPlayer()) {
                const player = castOn as Player;


                if (player.getSkillManager().getCurrentLevel(Skill.ATTACK) < player.getSkillManager().getMaxLevel(Skill.ATTACK)) {
                    return;
                }

                const decrease = Math.floor(0.1 * multiplier * player.getSkillManager().getCurrentLevel(Skill.ATTACK));
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
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => { cast.heal(Math.floor(damage * (0.25 * multiplier))); },
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
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => { getCombatFactory().freezeTicks(castOn, Math.floor(16 * multiplier), null, cast, "ice"); },
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
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => { if (Misc.getRandom(7) === 0) { getCombatFactory().poisonEntity(castOn, Math.floor(20 * multiplier)); } },
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
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => {
            shadowDrainNpc(castOn, 0.15, multiplier);
            if (castOn.isPlayer()) {
                const player = castOn as Player;

                if (player.getSkillManager().getCurrentLevel(Skill.ATTACK) < player.getSkillManager().getMaxLevel(Skill.ATTACK)) {
                    return;
                }

                const decrease = Math.floor(0.15 * multiplier * (player.getSkillManager().getCurrentLevel(Skill.ATTACK)));
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
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => { cast.heal(Math.floor(damage * (0.25 * multiplier))); },
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
        () => { return new Graphic(366, GraphicHeight.HIGH); },
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => { getCombatFactory().freezeTicks(castOn, Math.floor(24 * multiplier), null, cast, "ice"); },
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
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => { if (Misc.getRandom(7) === 0) { getCombatFactory().poisonEntity(castOn, Math.floor(20 * multiplier)); } },
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
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => {
            shadowDrainNpc(castOn, 0.15, multiplier);
            if (castOn.isPlayer()) {
                const player: Player = castOn as Player;


                if (player.getSkillManager().getCurrentLevel(Skill.ATTACK) < player.getSkillManager().getMaxLevel(Skill.ATTACK)) {
                    return;
                }

                const decrease: number = Math.floor(0.15 * multiplier * (player.getSkillManager().getCurrentLevel(Skill.ATTACK)));
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
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => { cast.heal(Math.floor(damage * (0.25 * multiplier))); },
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
        (cast: Mobile, castOn: Mobile, damage: number, multiplier: number) => { getCombatFactory().freezeTicks(castOn, Math.floor(32 * multiplier), null, cast, "ice"); },
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
