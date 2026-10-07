import type { Player } from "../../entity/impl/player/Player";
// Avoid importing Equipment to dodge bootstrap cycles; use slot ids directly.
const SHIELD_SLOT = 5;
import { ItemIdentifiers } from "../../../util/ItemIdentifiers";
export class CombatEquipment {
    public static hasDragonProtectionGear(player: Player): boolean {
        const shieldId = player.getEquipment().get(SHIELD_SLOT).getId();
        return shieldId == ItemIdentifiers.ANTI_DRAGON_SHIELD
            || shieldId == ItemIdentifiers.DRAGONFIRE_SHIELD
            || shieldId == ItemIdentifiers.DRAGONFIRE_WARD;
    }
}
