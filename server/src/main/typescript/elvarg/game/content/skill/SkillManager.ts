import { Skill } from "../../model/Skill";
import { Player } from "../../entity/impl/player/Player";
import { GameConstants } from "../../GameConstants";
import { PlayerRights } from "../../model/rights/PlayerRights";
import { Flag } from "../../model/Flag";
import { PrayerHandler } from "../PrayerHandler";
import { WeaponInterfaceManager } from "../combat/WeaponInterfaceManager";
import { BonusManager } from "../../model/equipment/BonusManager";
import { GameObject } from "../../entity/impl/object/GameObject";
import { EnteredAmountAction } from "../../model/EnteredAmountAction";
import { Wilderness } from "../wilderness/Wilderness";
import { PluginManager } from "../../../plugins/PluginManager";


class SkillEntered implements EnteredAmountAction {
    constructor(private readonly execFunc: Function) {
    }
    execute(amount: number): void {
        this.execFunc();
    }

}
export class SkillManager {
    public static readonly AMOUNT_OF_SKILLS: number = Skill.values().length;
    public static readonly MAX_EXPERIENCE: number = 1000000000;
    public static readonly XP_LOCKED_ATTRIBUTE = "skills:xp-locked";
    public static readonly EXPERIENCE_FOR_99: number = 13034431;
    public static readonly EXP_ARRAY: number[] = [0, 83, 174, 276, 388, 512, 650, 801, 969, 1154, 1358, 1584, 1833, 2107,
        2411, 2746, 3115, 3523, 3973, 4470, 5018, 5624, 6291, 7028, 7842, 8740, 9730, 10824, 12031, 13363, 14833,
        16456, 18247, 20224, 22406, 24815, 27473, 30408, 33648, 37224, 41171, 45529, 50339, 55649, 61512, 67983,
        75127, 83014, 91721, 101333, 111945, 123660, 136594, 150872, 166636, 184040, 203254, 224466, 247886, 273742,
        302288, 333804, 368599, 407015, 449428, 496254, 547953, 605032, 668051, 737627, 814445, 899257, 992895,
        1096278, 1210421, 1336443, 1475581, 1629200, 1798808, 1986068, 2192818, 2421087, 2673114, 2951373, 3258594,
        3597792, 3972294, 4385776, 4842295, 5346332, 5902831, 6517253, 7195629, 7944614, 8771558, 9684577, 10692629,
        11805606, 13034431];
    private static readonly BASE_COMBAT_SKILLS = [
        Skill.ATTACK,
        Skill.DEFENCE,
        Skill.STRENGTH,
        Skill.HITPOINTS,
        Skill.RANGED,
        Skill.PRAYER,
        Skill.MAGIC,
    ];

    /**
     * The player associated with this Skills instance.
     */
    private player: Player;
    public skills: Skills;

    public constructor(player: Player) {
        this.player = player;
        this.skills = new Skills();
        for (let i = 0; i < SkillManager.AMOUNT_OF_SKILLS; i++) {
            this.skills.level[i] = this.skills.maxLevel[i] = 1;
            this.skills.experience[i] = 0;
        }
        // Skill arrays use ordinal-style indices, never skill tab button ids.
        this.skills.level[Skill.HITPOINTS.getIndex()] = this.skills.maxLevel[Skill.HITPOINTS.getIndex()] = 10;
        this.skills.experience[Skill.HITPOINTS.getIndex()] = 1184;
    }

    static getExperienceForLevel(level: number): number {
        if (level <= 99) {
            return SkillManager.EXP_ARRAY[--level > 98 ? 98 : level];
        } else {
            let points = 0;
            let output = 0;
            for (let lvl = 1; lvl <= level; lvl++) {
                points += Math.floor(lvl + 300.0 * Math.pow(2.0, lvl / 7.0));
                if (lvl >= level) {
                    return output;
                }
                output = Math.floor(points / 4);
            }
        }
        return 0;
    }

    static getLevelForExperience(experience: number): number {
        if (experience <= SkillManager.EXPERIENCE_FOR_99) {
            for (let j = 98; j >= 0; j--) {
                if (SkillManager.EXP_ARRAY[j] <= experience) {
                    return j + 1;
                }
            }
        } else {
            let points = 0, output = 0;
            for (let lvl = 1; lvl <= 99; lvl++) {
                points += Math.floor(lvl + 300.0 * Math.pow(2.0, lvl / 7.0));
                output = Math.floor(points / 4);
                if (output >= experience) {
                    return lvl;
                }
            }
        }
        return 99;
    }

    static getMaxAchievingLevel(skill: Skill): number {
        return 99;
    }

    /**
     * Stored experience keeps tenths, as OSRS does (oak logs are 37.5, a hitpoints drop 1.3).
     * Rounding (not flooring) only clears float noise from adding tenths; flooring the stored
     * total threw the fraction away on every gain, so rate 1 ran slower than OSRS.
     */
    private static sanitizeExperienceValue(value: number): number {
        if (!Number.isFinite(value) || value <= 0) {
            return 0;
        }
        if (value >= SkillManager.MAX_EXPERIENCE) {
            return SkillManager.MAX_EXPERIENCE;
        }
        return Math.round(value * 10) / 10;
    }

    addExperiences(skill: Skill, experience: number): SkillManager {
        return this.addExperience(skill, experience, true);
    }

    addExperience(skill: Skill, experience: number, multipliers: boolean): SkillManager {
        if (!skill || typeof skill.getIndex !== "function") {
            return this;
        }
        if (!Number.isFinite(experience) || experience <= 0) {
            return this;
        }
        const gate = PluginManager.emitCanGainExperience(this.player, skill, experience);
        if (gate.allow === false) {
            return this;
        }

        // Multipliers: the world's rate, then the player's own (a league profile's rate).
        if (multipliers) {
            experience *= GameConstants.EXPERIENCE_MULTIPLIER * gate.multiplier;
        }
        // OSRS counts experience in tenths: a gain keeps its tenths and drops the rest
        // (4/3 per damage is 1.3 for one damage). The epsilon keeps 3.3 from reading as 3.29999.
        experience = Math.floor(experience * 10 + 1e-6) / 10;
        if (experience <= 0) {
            return this;
        }

        // Send exp drop..
        this.player.getPacketSender().sendExpDrop(skill, experience);

        // Don't add the experience if it has been locked..
        if (this.player.getAttribute(SkillManager.XP_LOCKED_ATTRIBUTE) === true)
            return this;

        // If we already have max exp, don't add any more.
        const skillIndex = skill.getIndex();
        const currentExperience = SkillManager.sanitizeExperienceValue(this.skills.experience[skillIndex]);
        this.skills.experience[skillIndex] = currentExperience;
        if (currentExperience >= SkillManager.MAX_EXPERIENCE)
            return this;

        // The skill's level before any experience is added
        const startingLevel = Number.isFinite(this.skills.maxLevel[skillIndex])
            ? Math.max(1, this.skills.maxLevel[skillIndex])
            : 1;
        this.skills.maxLevel[skillIndex] = startingLevel;

        // Add experience to the selected skill..
        this.skills.experience[skillIndex] = SkillManager.sanitizeExperienceValue(this.skills.experience[skillIndex] + experience);

        // Get the skill's new level after experience has been added..
        let newLevel = SkillManager.getLevelForExperience(this.skills.experience[skillIndex]);

        // Handle level up..
        if (newLevel > startingLevel) {
            let level = newLevel - startingLevel;
            this.skills.maxLevel[skill.getIndex()] += level;
            // Publish the new current level and native stats before feedback hooks run. The
            // message, graphic, pop-up and whether skilling stops belong to the SkillLevelUp plugin.
            this.setCurrentLevels(skill, this.skills.maxLevel[skill.getIndex()]);
            PluginManager.emitPlayerLevelUp({
                player: this.player,
                skill,
                oldLevel: startingLevel,
                newLevel: this.skills.maxLevel[skill.getIndex()],
            });
            this.player.getUpdateFlag().flag(Flag.APPEARANCE);
        }
        if (newLevel <= startingLevel) this.updateSkill(skill);
        // What landed: the gain less anything over the experience cap.
        PluginManager.emitExperienceGained({ player: this.player, skill, experience: this.skills.experience[skillIndex] - currentExperience });
        // The gain as it was added (after the rates and the tenths), for content that reacts to
        // experience itself (a league relic's bonus XP). `multiplied` says whether the rates applied.
        PluginManager.emitCustomEvent("skills:experience-gained", { player: this.player, skill, experience, multiplied: multipliers });
        return this;
    }

    pressedSkill(button: number): boolean {
        let skill = Skill.forButton(button);
        if (skill != null) {
            if (!skill.canSetLevel()) {
                if (this.player.getRights() != PlayerRights.ADMINISTRATOR && this.player.getRights() != PlayerRights.DEVELOPER
                    && this.player.getRights() != PlayerRights.OWNER) {
                    this.player.sendMessage("You can currently not set that level.");
                    return true;
                }
            }
            this.player.getPacketSender().sendInterfaceRemoval();
            this.player.setEnteredAmountAction(new SkillEntered((amount: number) => {
                let max = 99;
                if (this.player.getRights() == PlayerRights.OWNER
                    || this.player.getRights() == PlayerRights.DEVELOPER) {
                    max = 9999;
                }
                if (amount <= 0 || amount > max) {
                    this.player.sendMessage("Invalid syntax. Please enter a level in the range of 1-99.");
                    return;
                }
                this.player.getSkillManager().setLevel(skill, amount);
            }));
            this.player.getPacketSender()
                .sendEnterAmountPrompt("Please enter your desired " + skill.getName() + " level below.");

            return true;
        }
        return false;
    }

    setLevel(skill: Skill, level: number) {

        // Make sure they aren't in wild
        if (Wilderness.isIn(this.player)) {
            if (this.player.getRights() != PlayerRights.ADMINISTRATOR && this.player.getRights() != PlayerRights.DEVELOPER
                && this.player.getRights() != PlayerRights.OWNER) {
                this.player.sendMessage("You cannot do this in the Wilderness!");
                return;
            }
        }

        // make sure they aren't wearing any items which arent allowed to be worn at
        // that level.
        if (this.player.getRights() != PlayerRights.DEVELOPER) {
            for (let item of this.player.getEquipment().getItems()) {
                if (item == null) {
                    continue;
                }
                if (item.getDefinition().getRequirements() != null) {
                    if (item.getDefinition().getRequirements()[skill.getIndex()] > level) {
                        this.player.sendMessage(
                            "Please unequip your " + item.getDefinition().getName() + " before doing that.");
                        return;
                    }
                }
            }
        }

        if (skill == Skill.HITPOINTS) {
            if (level < 10) {
                this.player.sendMessage("Hitpoints must be set to at least level 10.");
                return;
            }
        }

        // Set skill level
        this.player.getSkillManager().setCurrentLevel(skill, level, false).setMaxLevels(skill, level, false)
            .setExperience(skill, SkillManager.getExperienceForLevel(level));
        this.updateSkill(skill);

        // Update weapon tab to send combat level etc.
        this.player.setHasVengeance(false);
        BonusManager.update(this.player);
        WeaponInterfaceManager.assign(this.player);
        PrayerHandler.deactivatePrayers(this.player);
        this.player.getUpdateFlag().flag(Flag.APPEARANCE);
    }

    public updateSkill(skill: Skill) {
        // The prayer-tab unlock varbits (5451-5453 and 3909) are not level
        // gates: a scroll or the quest owns them. SkillManager only sends the
        // skill delta, so a login/level-up/drain refresh cannot overwrite the
        // unlocks PrayerUnlocks.plugin.js has earned.
        // Native skill deltas also carry total and combat levels; legacy 317
        // text widgets do not exist in the OSRS interfaces.
        this.player.getPacketSender().sendSkill(skill);

        return this;
    }

    /**
     * Calculates the player's combat level.
     *
     * @return The average of the player's combat skills.
     */
    public getCombatLevel(): number {
        return SkillManager.calculateCombatLevel(this.skills.maxLevel);
    }

    /**
     * The combat level for a set of base levels, indexed by {@link Skill}'s ordinal.
     * Lets a caller value a loadout it has not put on a player yet, such as a preset's
     * own declared stats.
     *
     * @param levels Base levels by skill index.
     * @return The combat level, clamped to the 3-126 range a player can have.
     */
    public static calculateCombatLevel(levels: number[]): number {
        const attack = levels[Skill.ATTACK.getIndex()];
        const defence = levels[Skill.DEFENCE.getIndex()];
        const strength = levels[Skill.STRENGTH.getIndex()];
        const hp = levels[Skill.HITPOINTS.getIndex()];
        const prayer = levels[Skill.PRAYER.getIndex()];
        const ranged = levels[Skill.RANGED.getIndex()];
        const magic = levels[Skill.MAGIC.getIndex()];
        const base = (defence + hp + Math.floor(prayer / 2)) * 0.25;
        const melee = (attack + strength) * 0.325;
        const ranger = Math.floor(ranged * 1.5) * 0.325;
        const mage = Math.floor(magic * 1.5) * 0.325;
        return Math.min(126, Math.max(3, Math.floor(base + Math.max(melee, ranger, mage))));
    }

    private applyMinimumSkill(skill: Skill, minLevel: number, minExperience?: number): boolean {
        const idx = skill.getIndex();
        let updated = false;

        if (this.skills.maxLevel[idx] < minLevel) {
            this.skills.maxLevel[idx] = minLevel;
            updated = true;
        }
        if (this.skills.level[idx] < minLevel) {
            this.skills.level[idx] = minLevel;
            updated = true;
        }
        if (minExperience != null && this.skills.experience[idx] < minExperience) {
            this.skills.experience[idx] = minExperience;
            updated = true;
        }
        if (updated) {
            this.updateSkill(skill);
        }
        return updated;
    }

    public ensureCombatBaseline(): SkillManager {
        let baselineXp = SkillManager.getExperienceForLevel(10);
        let updated = false;

        for (const skill of Skill.values()) {
            const idx = skill.getIndex();
            const rawExp = Number(this.skills.experience[idx]);
            const rawMax = Number(this.skills.maxLevel[idx]);
            const rawLevel = Number(this.skills.level[idx]);

            const exp = SkillManager.sanitizeExperienceValue(rawExp);
            const levelFromExp = Math.max(1, SkillManager.getLevelForExperience(exp));
            const max = Number.isFinite(rawMax)
                ? Math.max(levelFromExp, Math.floor(rawMax))
                : levelFromExp;
            const level = Number.isFinite(rawLevel) ? Math.max(0, Math.floor(rawLevel)) : max;

            if (exp !== rawExp) {
                this.skills.experience[idx] = exp;
                updated = true;
            }
            if (max !== rawMax) {
                this.skills.maxLevel[idx] = max;
                updated = true;
            }
            if (level !== rawLevel) {
                this.skills.level[idx] = level;
                updated = true;
            }
        }

        baselineXp = Math.max(baselineXp, 1184);
        this.applyMinimumSkill(Skill.HITPOINTS, 10, baselineXp);

        for (const skill of SkillManager.BASE_COMBAT_SKILLS) {
            if (skill === Skill.HITPOINTS) {
                continue;
            }
            updated = this.applyMinimumSkill(skill, 1) || updated;
        }

        if (updated && this.player) {
            BonusManager.update(this.player);
        }

        return this;
    }

    public getTotalLevel(): number {
        let total = 0;
        for (const skill of Skill.values()) {
            total += this.skills.maxLevel[skill.getIndex()];
        }
        return total;
    }

    /**
     * Gets the player's total experience.
     *
     * @return The experience value from the player's every skill summed up.
     */
    public getTotalExp(): number {
        let xp = 0;
        for (const skill of Skill.values()) {
            xp += this.player.getSkillManager().getExperience(skill);
        }
        return xp;
    }

    /**
     * Gets the current level for said skill.
     *
     * @param skill The skill to get current/temporary level for.
     * @return The skill's level.
     */
    public getCurrentLevel(skill: Skill): number {
        const idx = skill.getIndex();
        const value = Number(this.skills.level[idx]);
        if (!Number.isFinite(value) || value < 0) {
            this.skills.level[idx] = 0;
            return 0;
        }
        return value;
    }

    /**
     * Gets the max level for said skill.
     *
     * @param skill The skill to get max level for.
     * @return The skill's maximum level.
     */
    public getMaxLevel(skill: Skill): number {
        const idx = skill.getIndex();
        const raw = Number(this.skills.maxLevel[idx]);
        const fromArray = Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 1;
        const fromExp = Math.max(1, SkillManager.getLevelForExperience(this.getExperience(skill)));
        // Don't write this back: mid-way through setMaxLevel(...).setExperience(...) the old
        // experience would pin the max level at its old value (issue #101).
        const level = Math.max(fromArray, fromExp);
        const cap = this.levelCaps.get(idx);
        return cap === undefined ? level : Math.max(1, Math.min(level, cap));
    }

    /** Temporary, unsaved caps on base levels, by skill index (a minigame's handicap, say). */
    private readonly levelCaps = new Map<number, number>();

    /**
     * Caps a skill's base level until cleared with `null`. Nothing is saved: the cap is gone
     * on the next login. The current level is lowered to the cap if above it.
     */
    public setMaxLevelCap(skill: Skill, cap: number | null): SkillManager {
        if (cap == null) this.levelCaps.delete(skill.getIndex());
        else this.levelCaps.set(skill.getIndex(), Math.max(1, Math.floor(cap)));
        if (cap != null && this.getCurrentLevel(skill) > this.getMaxLevel(skill)) {
            this.setCurrentLevel(skill, this.getMaxLevel(skill), false);
        }
        this.updateSkill(skill);
        return this;
    }

    /**
     * Gets the max level for said skill.
     *
     * @param skill The skill to get max level for.
     * @return The skill's maximum level.
     */
    public getMaxLevels(skill: number): number {
        return this.skills.maxLevel[skill];
    }

    /**
     * Gets the experience for said skill.
     *
     * @param skill The skill to get experience for.
     * @return The experience in said skill.
     */
    public getExperience(skill: Skill): number {
        const idx = skill.getIndex();
        const raw = Number(this.skills.experience[idx]);
        const sanitized = SkillManager.sanitizeExperienceValue(raw);
        if (this.skills.experience[idx] !== sanitized) {
            this.skills.experience[idx] = sanitized;
        }
        // Whole experience, as the skills packet and the client show it; the tenths stay stored.
        return Math.floor(sanitized);
    }

    /**
     * Sets the current level of said skill.
     *
     * @param skill The skill to set current/temporary level for.
     * @param level The level to set the skill to.
     * @param refresh If true, the skill's strings will be updated.
     * @return The Skills instance.
     */
    public setCurrentLevel(skill: Skill, level: number, refresh: boolean): SkillManager {
        const index = skill.getIndex();
        const previous = this.skills.level[index];
        const current = level < 0 ? 0 : level;
        this.skills.level[index] = current;
        if (previous !== current) {
            PluginManager.emitCustomEvent("skills:current-level-changed", {
                player: this.player, skill, previous, current,
            });
        }
        if (refresh) {
            this.updateSkill(skill);
        }
        return this;
    }


    setMaxLevels(skill: Skill, level: number, refresh = true) {
        this.skills.maxLevel[skill.getIndex()] = level;

        if (refresh) {
            this.updateSkill(skill);
        }
        return this;
    }

    setExperiences(skill: Skill, experience: number, refresh = true) {
        this.skills.experience[skill.getIndex()] = SkillManager.sanitizeExperienceValue(experience);
        if (refresh) {
            this.updateSkill(skill);
        }
        return this;
    }

    setCurrentLevels(skill: Skill, level: number, refresh = true) {
        // Java parity: this method updates the temporary/current level only.
        // Max/real level is managed through setMaxLevels/setMaxLevel.
        return this.setCurrentLevel(skill, level, refresh);
    }

    public setCurrentLevelCombat(skill: Skill, level: number) {
        this.setCurrentLevel(skill, level, true);
        return this;
    }

    setMaxLevel(skill: Skill, level: number) {
        return this.setMaxLevels(skill, level, true);
    }

    setExperience(skill: Skill, experience: number) {
        return this.setExperiences(skill, experience, true);
    }

    increaseCurrentLevelMax(skill: Skill, amount: number) {
        return this.increaseCurrentLevel(skill, amount, this.getMaxLevel(skill) + amount);
    }

    increaseCurrentLevel(skill: Skill, amount: number, max: number) {
        if (amount > 0) {
            // A restore or boost, whatever its source: plugins may change `amount` (a league
            // passive's Prayer gain); `max` stays the caller's cap.
            const restore = { player: this.player, skill, amount, max };
            PluginManager.emitCustomEvent("skills:restore", restore);
            if (restore.amount !== amount && Number.isFinite(restore.amount) && restore.amount >= 0) amount = Math.floor(restore.amount);
        }
        const curr = this.getCurrentLevel(skill);
        if ((curr + amount) > max) {
            this.setCurrentLevels(skill, max);
            return;
        }
        this.setCurrentLevels(skill, curr + amount);
    }

    public decreaseCurrentLevel(skill: Skill, amount: number, minimum: number) {
        let curr: number = this.getCurrentLevel(skill);
        if ((curr - amount) < minimum) {
            this.setCurrentLevels(skill, minimum);
            return;
        }
        this.setCurrentLevels(skill, curr - amount);
    }

    decreaseLevelMax(skill: Skill, amount: number) {
        return this.decreaseCurrentLevel(skill, amount, this.getMaxLevel(skill) - amount);
    }

    isBoosted(skill: Skill) {
        return this.getCurrentLevel(skill) > this.getMaxLevel(skill);
    }

    startSkillables(object: GameObject): boolean {
        return false;
    }

    startSkillable(skill: any) {
        // Stop previous skills..
        this.stopSkillable();

        // Close interfaces..
        this.player.getPacketSender().sendInterfaceRemoval();

        // Check if we have the requirements to start this skill..
        if (!skill.hasRequirements(this.player)) {
            return;
        }

        // Start the skill..
        this.player.setSkill(skill);
        skill.start(this.player);
    }

    stopSkillable() {
        if (this.player.getSkill()) {
            this.player.getSkill().cancel(this.player);
        }
        this.player.setSkill(null);
        this.player.setCreationMenu(null);
    }

    getSkills() {
        return this.skills;
    }

    setSkills(skills: Skills) {
        if (!skills) {
            return;
        }

        const next = new Skills();
        const hpIndex = Skill.HITPOINTS.getIndex();
        const hpMinXp = Math.max(0, SkillManager.getExperienceForLevel(10));

        for (let i = 0; i < SkillManager.AMOUNT_OF_SKILLS; i++) {
            const rawExp = Array.isArray(skills.experience) ? Number(skills.experience[i]) : NaN;
            const rawMax = Array.isArray(skills.maxLevel) ? Number(skills.maxLevel[i]) : NaN;
            const rawLevel = Array.isArray(skills.level) ? Number(skills.level[i]) : NaN;

            const exp = SkillManager.sanitizeExperienceValue(rawExp);
            const maxFromExp = Math.max(1, SkillManager.getLevelForExperience(exp));
            const max = Number.isFinite(rawMax)
                ? Math.max(maxFromExp, Math.floor(rawMax))
                : maxFromExp;
            const current = Number.isFinite(rawLevel)
                ? Math.max(0, Math.floor(rawLevel))
                : max;

            next.experience[i] = (i === hpIndex) ? Math.max(exp, hpMinXp) : exp;
            next.maxLevel[i] = (i === hpIndex) ? Math.max(max, 10) : max;
            next.level[i] = (i === hpIndex) ? Math.max(current, 10) : current;
        }

        this.skills = next;
    }
}

export class Skills {
    public level: number[];
    public maxLevel: number[];
    public experience: number[];
    constructor() {
        this.level = new Array(SkillManager.AMOUNT_OF_SKILLS).fill(0);
        this.maxLevel = new Array(SkillManager.AMOUNT_OF_SKILLS).fill(1);
        this.experience = new Array(SkillManager.AMOUNT_OF_SKILLS).fill(0);
        this.level[Skill.HITPOINTS.getIndex()] = 10;
        this.maxLevel[Skill.HITPOINTS.getIndex()] = 10;
        this.experience[Skill.HITPOINTS.getIndex()] = Math.max(0, SkillManager.getExperienceForLevel(10));
    }

    getLevels() {
        return this.level;
    }

    setLevels(levels: number[]) {
        this.level = levels;
    }

    getMaxLevels() {
        return this.maxLevel;
    }

    setMaxLevels(maxLevels: number[]) {
        this.maxLevel = maxLevels;
    }

    getExperiences() {
        return this.experience;
    }

    setExperiences(experiences: number[]) {
        this.experience = experiences;
    }
}
