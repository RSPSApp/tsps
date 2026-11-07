import { Player } from "../../../entity/impl/player/Player";
import { Skill } from "../../../model/Skill";
import { PluginManager } from "../../../../plugins/PluginManager";

const CLEANING_XP = new Map<number, number>([
    [199, 2], [201, 4], [203, 5], [205, 6], [207, 7], [209, 10],
    [211, 12], [213, 13], [215, 14], [217, 18], [219, 21],
    [2485, 13.5], [3049, 8], [3051, 21.5],
]);

const CLEAN_HERB = new Map<number, number>([
    [199, 249], [201, 251], [203, 253], [205, 255], [207, 257], [209, 259], [211, 261],
    [213, 263], [215, 265], [217, 267], [219, 269], [2485, 2481], [3049, 2998], [3051, 3000],
]);

export class ArceuusUtilities {
    private static eligibleCleanId(player: Player, grimyId: number): number | undefined {
        const cleanId = CLEAN_HERB.get(grimyId);
        if (cleanId == null) return undefined;
        const herb: { grimyId: number; clean: number | null; level: number | null } = { grimyId, clean: null, level: null };
        PluginManager.emitCustomEvent("herblore:clean", herb);
        const boost = { player, skill: Skill.HERBLORE, boost: 0 };
        PluginManager.emitCustomEvent("skills:level-boost", boost);
        const level = player.getSkillManager().getCurrentLevel(Skill.HERBLORE) + Math.max(0, boost.boost | 0);
        return herb.level != null && level >= herb.level ? cleanId : undefined;
    }

    public static hasGrimyHerbs(player: Player): boolean {
        return player.getInventory().getValidItems().some((item) => this.eligibleCleanId(player, item.getId()) != null);
    }

    public static degrime(player: Player): void {
        let experience = 0;
        for (const item of player.getInventory().getValidItems()) {
            const grimyId = item.getId();
            const cleanId = this.eligibleCleanId(player, grimyId);
            if (cleanId != null) {
                item.setId(cleanId);
                experience += (CLEANING_XP.get(grimyId) ?? 0) / 2;
            }
        }
        player.getInventory().refreshItems();
        if (experience > 0) player.getSkillManager().addExperiences(Skill.HERBLORE, experience);
    }
}
