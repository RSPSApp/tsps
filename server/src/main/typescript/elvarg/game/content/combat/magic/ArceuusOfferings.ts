import { Player } from "../../../entity/impl/player/Player";
import { Skill } from "../../../model/Skill";
import { ItemIds } from "../../../../util/IdEnums";

export const BONE_XP = new Map<number, number>([
    [ItemIds.BONES, 5], [ItemIds.BAT_BONES, 6], [ItemIds.WOLF_BONES, 6], [ItemIds.BIG_BONES, 15],
    [ItemIds.BABYDRAGON_BONES, 30], [ItemIds.JOGRE_BONES, 15], [ItemIds.ZOGRE_BONES, 23],
    [ItemIds.LONG_BONE, 15], [ItemIds.CURVED_BONE, 15], [ItemIds.SHAIKAHAN_BONES, 25],
    [ItemIds.DRAGON_BONES, 72], [ItemIds.FAYRG_BONES, 84], [ItemIds.RAURG_BONES, 96],
    [ItemIds.OURG_BONES, 140], [ItemIds.DAGANNOTH_BONES, 125], [ItemIds.WYVERN_BONES_2, 72],
    [ItemIds.LAVA_DRAGON_BONES, 85],
]);

const ASH_XP = new Map<number, number>([
    [ItemIds.FIENDISH_ASHES, 10], [ItemIds.VILE_ASHES, 25], [ItemIds.MALICIOUS_ASHES, 65],
    [ItemIds.ABYSSAL_ASHES, 85], [ItemIds.INFERNAL_ASHES, 110], [ItemIds.ELDRITCH_ASHES, 200],
]);

export class ArceuusOfferings {
    public static hasDemonicRemains(player: Player): boolean {
        return player.getInventory().getValidItems().some((item) => ASH_XP.has(item.getId()));
    }

    public static hasBones(player: Player): boolean {
        return player.getInventory().getValidItems().some((item) => BONE_XP.has(item.getId()));
    }

    public static sinister(player: Player): boolean {
        return this.offer(player, (id) => BONE_XP.get(id) ?? 0, 3, 3);
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
            player.getInventory().deleteNumber(item.getId(), 1);
            prayerXp += experience(item.getId()) * multiplier;
            prayerPoints += prayerRestore(item.getId());
        }
        player.getSkillManager().addExperiences(Skill.PRAYER, prayerXp);
        player.getSkillManager().increaseCurrentLevel(Skill.PRAYER, prayerPoints, player.getSkillManager().getMaxLevel(Skill.PRAYER));
        return true;
    }
}
