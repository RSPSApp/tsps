import { Player } from "../../../entity/impl/player/Player";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { ItemIdentifiers } from "../../../../util/ItemIdentifiers";
import { FightStyle } from "../FightStyle";
import { FightType } from "../FightType";
import { CombatSpell } from "./CombatSpell";
import { CombatSpells } from "./CombatSpells";
import { Barrows } from "../Barrows";

const getBonusManager = () => require("../../../model/equipment/BonusManager").BonusManager as typeof import("../../../model/equipment/BonusManager").BonusManager;

export class Autocasting {
    private static readonly COMBAT_INTERFACE = 593;
    private static readonly AUTOCAST_INTERFACE = 201;
    private static readonly AUTOCAST_CONTAINER = 1;

    public static readonly ANCIENT_SPELL_AUTOCAST_STAFFS = new Set<number>([
        ItemIdentifiers.KODAI_WAND, ItemIdentifiers.MASTER_WAND, ItemIdentifiers.ANCIENT_STAFF,
        ItemIdentifiers.NIGHTMARE_STAFF, ItemIdentifiers.VOLATILE_NIGHTMARE_STAFF,
        ItemIdentifiers.ELDRITCH_NIGHTMARE_STAFF, ItemIdentifiers.TOXIC_STAFF_OF_THE_DEAD,
        ItemIdentifiers.STAFF_OF_THE_DEAD, ItemIdentifiers.STAFF_OF_LIGHT,
    ]);

    private static readonly AUTOCAST_SPELLS = new Map<number, CombatSpell>([
        [1, CombatSpells.WIND_STRIKE], [2, CombatSpells.WATER_STRIKE],
        [3, CombatSpells.EARTH_STRIKE], [4, CombatSpells.FIRE_STRIKE],
        [5, CombatSpells.WIND_BOLT], [6, CombatSpells.WATER_BOLT],
        [7, CombatSpells.EARTH_BOLT], [8, CombatSpells.FIRE_BOLT],
        [9, CombatSpells.WIND_BLAST], [10, CombatSpells.WATER_BLAST],
        [11, CombatSpells.EARTH_BLAST], [12, CombatSpells.FIRE_BLAST],
        [13, CombatSpells.WIND_WAVE], [14, CombatSpells.WATER_WAVE],
        [15, CombatSpells.EARTH_WAVE], [16, CombatSpells.FIRE_WAVE],
        [48, CombatSpells.WIND_SURGE], [49, CombatSpells.WATER_SURGE],
        [50, CombatSpells.EARTH_SURGE], [51, CombatSpells.FIRE_SURGE],
        [17, CombatSpells.CRUMBLE_UNDEAD], [18, CombatSpells.MAGIC_DART],
        [19, CombatSpells.IBAN_BLAST],
        [31, CombatSpells.SMOKE_RUSH], [32, CombatSpells.SHADOW_RUSH],
        [33, CombatSpells.BLOOD_RUSH], [34, CombatSpells.ICE_RUSH],
        [35, CombatSpells.SMOKE_BURST], [36, CombatSpells.SHADOW_BURST],
        [37, CombatSpells.BLOOD_BURST], [38, CombatSpells.ICE_BURST],
        [39, CombatSpells.SMOKE_BLITZ], [40, CombatSpells.SHADOW_BLITZ],
        [41, CombatSpells.BLOOD_BLITZ], [42, CombatSpells.ICE_BLITZ],
        [43, CombatSpells.SMOKE_BARRAGE], [44, CombatSpells.SHADOW_BARRAGE],
        [45, CombatSpells.BLOOD_BARRAGE], [46, CombatSpells.ICE_BARRAGE],
    ]);

    public static autocastSpell(index: number): CombatSpell | null {
        return this.AUTOCAST_SPELLS.get(index) ?? null;
    }

    public static handleWidgetAction(player: Player, groupId: number, childId: number, slot?: number): boolean {
        if (groupId === this.COMBAT_INTERFACE && childId === 26) {
            this.setAutocast(player, null);
            return true;
        }
        if (groupId === this.COMBAT_INTERFACE && (childId === 23 || childId === 28)) {
            return this.openSelector(player, childId === 23);
        }
        if (groupId !== this.AUTOCAST_INTERFACE || childId !== this.AUTOCAST_CONTAINER || slot === undefined) return false;
        if (slot === 0) {
            this.openCombatInterface(player);
            return true;
        }
        const spell = slot === 20
            ? this.godSpell(player.getEquipment().getWeapon().getId())
            : this.autocastSpell(slot);
        if (spell) this.setAutocast(player, spell);
        this.openCombatInterface(player);
        return true;
    }

    private static openSelector(player: Player, defensive: boolean): boolean {
        if (player.getSpellbook() === MagicSpellbook.LUNAR) {
            player.sendMessage("You can't autocast lunar spells.");
            return true;
        }
        if (!player.getEquipment().hasStaffEquipped()) {
            player.sendMessage("You need to equip a staff to autocast spells.");
            return true;
        }

        const weaponId = player.getEquipment().getWeapon().getId();
        if (player.getSpellbook() === MagicSpellbook.ANCIENT &&
            !this.ANCIENT_SPELL_AUTOCAST_STAFFS.has(weaponId) && !Barrows.hasDamnedSet(player, "ahrims")) {
            player.sendMessage("You can only autocast regular offensive spells with this staff.");
            return true;
        }
        if (player.getSpellbook() === MagicSpellbook.NORMAL && weaponId === ItemIdentifiers.ANCIENT_STAFF) {
            player.sendMessage("You can only autocast ancient magicks with that.");
            return true;
        }

        const fightType = defensive ? FightType.STAFF_FOCUS : FightType.STAFF_POUND;
        player.setFightType(fightType);
        player.getPacketSender()
            .sendConfig(fightType.getParentId(), fightType.getChildId())
            .sendConfig(664, player.getSpellbook() === MagicSpellbook.ANCIENT ? weaponId : -1)
            .sendSubInterface((161 << 16) | 76, this.AUTOCAST_INTERFACE)
            .sendInterfaceFlagsRange((this.AUTOCAST_INTERFACE << 16) | this.AUTOCAST_CONTAINER, 0, 64, 1 << 1)
            .sendMessage("You can set a default autocast spell any time from the magic tab.");
        return true;
    }

    private static openCombatInterface(player: Player): void {
        player.getPacketSender().sendTabInterface(0, this.COMBAT_INTERFACE);
    }

    public static setAutocast(player: Player, spell: CombatSpell | null): void {
        player.getCombat().setAutocastSpell(spell);
        const activeSpell = player.getEquipment().hasStaffEquipped() ? spell : null;
        if (activeSpell == null && spell != null) {
            player.sendMessage("Default spell set. Please equip a staff to use autocast.");
        }

        this.refreshIndicators(player);
        getBonusManager().update(player);
        if (activeSpell != null) {
            const childId = player.getFightType()?.getChildId?.() ?? FightType.STAFF_POUND.getChildId();
            player.getPacketSender().sendConfig(FightType.STAFF_BASH.getParentId(), childId);
        }
    }

    public static refreshIndicators(player: Player): void {
        const spell = player.getEquipment().hasStaffEquipped() ? player.getCombat().getAutocastSpell() : null;
        const defensive = player.getFightType()?.getStyle?.() === FightStyle.DEFENSIVE;
        player.getPacketSender()
            .sendVarbit(275, spell == null ? 0 : 1)
            .sendVarbit(276, spell == null ? 0 : this.resolveAutocastIndex(spell))
            .sendVarbit(2668, spell != null && defensive ? 1 : 0);
    }

    private static resolveAutocastIndex(spell: CombatSpell): number {
        for (const [index, mappedSpell] of this.AUTOCAST_SPELLS) {
            if (mappedSpell === spell) return index;
        }
        return 0;
    }

    private static godSpell(weaponId: number): CombatSpell | null {
        if (weaponId === ItemIdentifiers.SARADOMIN_STAFF || weaponId === ItemIdentifiers.STAFF_OF_LIGHT) return CombatSpells.SARADOMIN_STRIKE;
        if (weaponId === ItemIdentifiers.GUTHIX_STAFF) return CombatSpells.CLAWS_OF_GUTHIX;
        if (weaponId === ItemIdentifiers.ZAMORAK_STAFF) return CombatSpells.FLAMES_OF_ZAMORAK;
        return null;
    }
}
