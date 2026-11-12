import { Player } from "../../../entity/impl/player/Player";
import { Skill } from "../../../model/Skill";
import { PluginManager } from "../../../../plugins/PluginManager";

/** Herblore's own table answers ("herblore:clean"): every normal grimy herb, with its level and XP. */
type Clean = { grimyId: number; clean: number | null; level: number | null; xp: number | null };

export class ArceuusUtilities {
    /**
     * Wiki (Degrime): it "cleans all grimy herbs" the player has the Herblore level for, for half
     * their cleaning XP. Herblore's table holds every one, grimy huasca included.
     */
    private static eligibleClean(player: Player, grimyId: number): Clean | undefined {
        const herb: Clean = { grimyId, clean: null, level: null, xp: null };
        PluginManager.emitCustomEvent("herblore:clean", herb);
        if (herb.clean == null || herb.level == null) return undefined;
        const boost = { player, skill: Skill.HERBLORE, boost: 0 };
        PluginManager.emitCustomEvent("skills:level-boost", boost);
        const level = player.getSkillManager().getCurrentLevel(Skill.HERBLORE) + Math.max(0, boost.boost | 0);
        return level >= herb.level ? herb : undefined;
    }

    public static hasGrimyHerbs(player: Player): boolean {
        return player.getInventory().getValidItems().some((item) => this.eligibleClean(player, item.getId()) != null);
    }

    public static degrime(player: Player): void {
        let experience = 0;
        for (const item of player.getInventory().getValidItems()) {
            const herb = this.eligibleClean(player, item.getId());
            if (herb?.clean != null) {
                item.setId(herb.clean);
                experience += (herb.xp ?? 0) / 2;
            }
        }
        player.getInventory().refreshItems();
        if (experience > 0) player.getSkillManager().addExperiences(Skill.HERBLORE, experience);
    }
}
