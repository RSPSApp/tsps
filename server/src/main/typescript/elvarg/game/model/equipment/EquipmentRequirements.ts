import { ItemDefinition } from "../../definition/ItemDefinition";
import { Skill } from "../Skill";
import { Misc } from "../../../util/Misc";

/** Whatever a wearer's levels can be read from: a Player, or a preset's declared stats. */
export interface RequirementLevels {
    getSkillManager(): {
        getMaxLevel(skill: Skill): number;
        getCombatLevel(): number;
    };
}

export interface UnmetRequirement {
    /** Skill display name ("Ranged"), or "combat" for a combat-level gate. */
    label: string;
    level: number;
}

/**
 * The levels an item demands to be worn. Skills come from the item's requirement array;
 * a combat level has no Skill of its own, so it rides alongside as its own value.
 */
export class EquipmentRequirements {
    /** The first requirement not met, or null when the wearer can put the item on. */
    public static getUnmet(
        wearer: RequirementLevels,
        definition: ItemDefinition
    ): UnmetRequirement | null {
        const skillManager = wearer.getSkillManager();
        const requirements = definition.getRequirements();
        if (requirements != null) {
            for (const skill of Skill.values()) {
                const requiredLevel = requirements[skill.getIndex()] ?? 0;
                if (requiredLevel > skillManager.getMaxLevel(skill)) {
                    return { label: Misc.formatText(skill.getName()), level: requiredLevel };
                }
            }
        }
        const requiredCombatLevel = definition.getCombatRequirement();
        if (requiredCombatLevel > skillManager.getCombatLevel()) {
            return { label: "combat", level: requiredCombatLevel };
        }
        return null;
    }

    public static meets(
        wearer: RequirementLevels,
        definition: ItemDefinition
    ): boolean {
        return this.getUnmet(wearer, definition) == null;
    }

    /**
     * @param unmet The requirement the wearer is short of.
     * @param subject What they are reaching for; a preset names the item instead.
     */
    public static message(unmet: UnmetRequirement, subject: string = "this"): string {
        const vowel = /^[aeiou]/i.test(unmet.label) ? "an" : "a";
        return `You need ${vowel} ${unmet.label} level of at least ${unmet.level} to wear ${subject}.`;
    }
}
