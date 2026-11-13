import { Player } from "../../../entity/impl/player/Player";
import { Skill } from "../../../model/Skill";
import { ItemIds } from "../../../../util/IdEnums";

/**
 * Sinister Offering's bones and their burying experience (Wiki: Sinister Offering's table, 300% a bone). Long and curved
 * bones were removed in 2023; wyvern bones are the bones (6812), not their note.
 */
export const BONE_XP = new Map<number, number>([
    [ItemIds.BONES, 4.5], [ItemIds.WOLF_BONES, 4.5], [ItemIds.MONKEY_BONES, 5], [ItemIds.BAT_BONES, 5.3],
    [ItemIds.BIG_BONES, 15], [ItemIds.JOGRE_BONES, 15], [ItemIds.WYRMLING_BONES, 21], [ItemIds.ZOGRE_BONES, 22.5],
    [ItemIds.SHAIKAHAN_BONES, 25], [ItemIds.BABYDRAGON_BONES, 30], [ItemIds.WYRM_BONES, 50],
    [ItemIds.STRYKEWYRM_BONES, 60], [ItemIds.DRAGON_BONES, 72], [ItemIds.WYVERN_BONES, 72], [ItemIds.DRAKE_BONES, 80],
    [ItemIds.FAYRG_BONES, 84], [ItemIds.LAVA_DRAGON_BONES, 85], [ItemIds.RAURG_BONES, 96],
    [ItemIds.FROST_DRAGON_BONES, 100], [ItemIds.HYDRA_BONES, 110], [ItemIds.DAGANNOTH_BONES, 125],
    [ItemIds.OURG_BONES, 140], [ItemIds.SUPERIOR_DRAGON_BONES, 150],
]);

/** Wiki (Sinister Offering): two prayer points for these, one for every other set. */
const TWO_POINT_BONES = new Set<number>([
    ItemIds.OURG_BONES, ItemIds.DAGANNOTH_BONES, ItemIds.HYDRA_BONES, ItemIds.SUPERIOR_DRAGON_BONES,
]);

/**
 * Demonic Offering's ashes and their scattering experience (Wiki: Demonic Offering's table, 300% an ash). Eldritch ashes
 * are Akkha's remains from the Tombs of Amascut, not on the table.
 */
const ASH_XP = new Map<number, number>([
    [ItemIds.FIENDISH_ASHES, 10], [ItemIds.VILE_ASHES, 25], [ItemIds.MALICIOUS_ASHES, 65],
    [ItemIds.ABYSSAL_ASHES, 85], [ItemIds.INFERNAL_ASHES, 110],
]);

export class ArceuusOfferings {
    public static hasDemonicRemains(player: Player): boolean {
        return player.getInventory().getValidItems().some((item) => ASH_XP.has(item.getId()));
    }

    public static hasBones(player: Player): boolean {
        return player.getInventory().getValidItems().some((item) => BONE_XP.has(item.getId()));
    }

    /** The refusal before any runes are spent: 70 Prayer is needed to offer superior dragon bones (Wiki), not to cast. */
    public static sinisterRefusal(player: Player): string | null {
        const items = player.getInventory().getValidItems();
        const lowPrayer = player.getSkillManager().getMaxLevel(Skill.PRAYER) < 70;
        const others = items.some((item) => BONE_XP.has(item.getId()) && item.getId() !== ItemIds.SUPERIOR_DRAGON_BONES);
        return lowPrayer && !others && items.some((item) => item.getId() === ItemIds.SUPERIOR_DRAGON_BONES)
            ? "You require a Prayer level of 70 to do that." : null;
    }

    public static sinister(player: Player): boolean {
        const lowPrayer = player.getSkillManager().getMaxLevel(Skill.PRAYER) < 70;
        const offered = (id: number) => (id === ItemIds.SUPERIOR_DRAGON_BONES && lowPrayer ? 0 : BONE_XP.get(id) ?? 0);
        return this.offer(player, offered, 3, 3, (id) => TWO_POINT_BONES.has(id) ? 2 : 1);
    }

    public static demonic(player: Player): boolean {
        return this.offer(player, (id) => ASH_XP.get(id) ?? 0, 3, 3, (id) => id === ItemIds.INFERNAL_ASHES ? 2 : 1);
    }

    private static offer(player: Player, experience: (id: number) => number, maxItems: number, multiplier: number, prayerRestore = (_id: number) => 1): boolean {
        const items = player.getInventory().getValidItems().filter((item) => experience(item.getId()) > 0).slice(0, maxItems);
        if (items.length === 0) {
            player.sendMessage("You do not have any suitable remains in your inventory.");
            return false;
        }
        let prayerXp = 0;
        let prayerPoints = 0;
        for (const item of items) {
            // The id before the delete: deleting a slot's last one empties it (id -1), which paid nothing.
            const id = item.getId();
            player.getInventory().deleteNumber(id, 1);
            prayerXp += experience(id) * multiplier;
            prayerPoints += prayerRestore(id);
        }
        player.getSkillManager().addExperiences(Skill.PRAYER, prayerXp);
        player.getSkillManager().increaseCurrentLevel(Skill.PRAYER, prayerPoints, player.getSkillManager().getMaxLevel(Skill.PRAYER));
        return true;
    }
}
