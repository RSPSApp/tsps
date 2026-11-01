import { Player } from "../../../entity/impl/player/Player";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { ItemAliases } from "../../../model/ItemAliases";
import { ItemIdentifiers } from "../../../../util/ItemIdentifiers";
import { FightStyle } from "../FightStyle";
import { FightType } from "../FightType";
import { CombatSpell } from "./CombatSpell";
import { CombatSpells } from "./CombatSpells";
import { Barrows } from "../Barrows";

const getBonusManager = () => require("../../../model/equipment/BonusManager").BonusManager as typeof import("../../../model/equipment/BonusManager").BonusManager;

export class Autocasting {
    private static readonly COMBAT_INTERFACE = 593;
    /**
     * Varp 43 (com_mode) is 0-3 for the weapon's styles and 4 while a spell is autocast (rsprox
     * captures: choosing a spell sets it to 4, and choosing a style clears autocast and sets 0-3).
     */
    private static readonly COM_MODE_VARP = 43;
    private static readonly COM_MODE_AUTOCAST = 4;
    private static readonly AUTOCAST_INTERFACE = 201;
    private static readonly AUTOCAST_CONTAINER = 1;

    public static readonly ANCIENT_SPELL_AUTOCAST_STAFFS = new Set<number>([
        ItemIdentifiers.KODAI_WAND, ItemIdentifiers.MASTER_WAND, ItemIdentifiers.ANCIENT_STAFF,
        ItemIdentifiers.NIGHTMARE_STAFF, ItemIdentifiers.VOLATILE_NIGHTMARE_STAFF,
        ItemIdentifiers.ELDRITCH_NIGHTMARE_STAFF,
        ItemIdentifiers.ZURIELS_STAFF, ItemIdentifiers.ZURIELS_STAFF_BH_,
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
        // Arceuus (cache script 4133: 53-55 the top row, 56-58 the bottom; enum 1986's icons):
        // the demonbanes on top, the grasps below.
        [53, CombatSpells.INFERIOR_DEMONBANE], [54, CombatSpells.SUPERIOR_DEMONBANE],
        [55, CombatSpells.DARK_DEMONBANE], [56, CombatSpells.GHOSTLY_GRASP],
        [57, CombatSpells.SKELETAL_GRASP], [58, CombatSpells.UNDEAD_GRASP],
    ]);

    /** Wiki (Autocast): the weapons that can autocast Arceuus spells, by name (any charge or degrade). */
    private static readonly ARCEUUS_AUTOCAST_WEAPONS = [
        "ahrim's staff", "blue moon spear", "kodai wand", "master wand", "purging staff", "skull sceptre",
        "slayer's staff", "staff of the dead", "toxic staff of the dead",
    ];

    /**
     * Varp 664 picks the autocast selector's spell list (cache scripts 2098 and 243): -1 the standard
     * spellbook, 4675 the ancient one, 4170 the Slayer's staff's waves, surges, Crumble Undead and
     * Magic Dart, and 9013 (the skull sceptre's entry) the Arceuus one.
     */
    private static readonly SELECTOR_STANDARD = -1;
    private static readonly SELECTOR_SLAYERS_STAFF = ItemIdentifiers.SLAYERS_STAFF;
    private static readonly SELECTOR_ARCEUUS = ItemIdentifiers.SKULL_SCEPTRE;

    public static canAutocastArceuus(weaponName: string): boolean {
        const name = weaponName.trim().toLowerCase();
        return this.ARCEUUS_AUTOCAST_WEAPONS.some((weapon) => name === weapon || name.startsWith(`${weapon} `));
    }

    /** What varp 664 is set to when the selector opens, for this spellbook and weapon. */
    public static selectorList(spellbook: MagicSpellbook, weaponId: number): number {
        if (spellbook === MagicSpellbook.ANCIENT) return ItemIdentifiers.ANCIENT_STAFF;
        if (spellbook === MagicSpellbook.ARCEUUS) return this.SELECTOR_ARCEUUS;
        if (weaponId === ItemIdentifiers.SLAYERS_STAFF || weaponId === ItemIdentifiers.SLAYERS_STAFF_E_) {
            return this.SELECTOR_SLAYERS_STAFF;
        }
        return this.SELECTOR_STANDARD;
    }

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
        const refusal = this.weaponRefusal(player, player.getSpellbook());
        if (refusal != null) {
            player.sendMessage(refusal);
            return true;
        }

        const fightType = this.selectorFightType(player, defensive);
        player.setFightType(fightType);
        player.getPacketSender()
            .sendConfig(fightType.getParentId(), fightType.getChildId())
            .sendConfig(664, this.selectorList(player.getSpellbook(), weaponId))
            .sendSubInterface((161 << 16) | 76, this.AUTOCAST_INTERFACE)
            .sendInterfaceFlagsRange((this.AUTOCAST_INTERFACE << 16) | this.AUTOCAST_CONTAINER, 0, 64, 1 << 1)
            .sendMessage("You can set a default autocast spell any time from the magic tab.");
        return true;
    }

    /**
     * Why the wielded weapon can't autocast spells from `spellbook`, or null when it can (wiki: Autocast).
     * Only the ancient staff family autocasts Ancient Magicks (the Staff of the Dead and Staff of Light
     * don't), and the Ancient staff autocasts nothing else.
     */
    private static weaponRefusal(player: Player, spellbook: MagicSpellbook): string | null {
        const weapon = player.getEquipment().getWeapon();
        const weaponId = weapon.getId();
        if (spellbook === MagicSpellbook.ANCIENT &&
            !this.ANCIENT_SPELL_AUTOCAST_STAFFS.has(weaponId) &&
            !this.ANCIENT_SPELL_AUTOCAST_STAFFS.has(ItemAliases.baseOf(weaponId) ?? -1) &&
            !Barrows.hasDamnedSet(player, "ahrims")) {
            return "You can only autocast regular offensive spells with this staff.";
        }
        if (spellbook === MagicSpellbook.NORMAL && weaponId === ItemIdentifiers.ANCIENT_STAFF) {
            return "You can only autocast ancient magicks with that.";
        }
        if (spellbook === MagicSpellbook.ARCEUUS && !this.canAutocastArceuus(weapon.getDefinition().getName())) {
            return "You can only autocast regular offensive spells with this staff.";
        }
        return null;
    }

    /** Whether the wielded weapon is a staff that can autocast `spell`. */
    public static canAutocast(player: Player, spell: CombatSpell): boolean {
        return player.getEquipment().hasStaffEquipped() && this.weaponRefusal(player, spell.getSpellbook()) == null;
    }

    /** The weapon's own defensive or aggressive style (Focus/Pound on a staff, Fend/Swipe on a bladed staff). */
    private static selectorFightType(player: Player, defensive: boolean): FightType {
        const wanted = defensive ? FightStyle.DEFENSIVE : FightStyle.AGGRESSIVE;
        const styles = player.getEquipment().getWeapon().getDefinition()?.getWeaponInterface?.()?.getFightType?.() ?? [];
        return styles.find((type) => type.getStyle() === wanted)
            ?? (defensive ? FightType.STAFF_FOCUS : FightType.STAFF_POUND);
    }

    private static openCombatInterface(player: Player): void {
        player.getPacketSender().sendTabInterface(0, this.COMBAT_INTERFACE);
    }

    /**
     * Sets (or, after an equipment switch or login, restores) the autocast spell. A staff that can't
     * cast it clears it rather than keeping it, so switching from an Ancient staff to a Staff of the
     * Dead doesn't go on casting Ice Barrage.
     */
    public static setAutocast(player: Player, spell: CombatSpell | null): void {
        if (spell != null && player.getEquipment().hasStaffEquipped() && !this.canAutocast(player, spell)) {
            spell = null;
        }
        player.getCombat().setAutocastSpell(spell);
        const activeSpell = player.getEquipment().hasStaffEquipped() ? spell : null;
        if (activeSpell == null && spell != null) {
            player.sendMessage("Default spell set. Please equip a staff to use autocast.");
        }

        this.refreshIndicators(player);
        getBonusManager().update(player);
    }

    /**
     * Choosing one of the weapon's styles turns autocast off (rsprox captures: autocast_set and
     * autocast_spell go to 0 on the same tick). The default spell isn't kept.
     */
    public static clearForStyle(player: Player): void {
        if (player.getCombat().getAutocastSpell() == null) return;
        player.getCombat().setAutocastSpell(null);
        this.refreshIndicators(player);
    }

    public static refreshIndicators(player: Player): void {
        const spell = player.getEquipment().hasStaffEquipped() ? player.getCombat().getAutocastSpell() : null;
        const defensive = player.getFightType()?.getStyle?.() === FightStyle.DEFENSIVE;
        player.getPacketSender()
            .sendVarbit(275, spell == null ? 0 : 1)
            .sendVarbit(276, spell == null ? 0 : this.resolveAutocastIndex(spell))
            .sendVarbit(2668, spell != null && defensive ? 1 : 0);
        if (spell != null) {
            player.getPacketSender().sendConfig(this.COM_MODE_VARP, this.COM_MODE_AUTOCAST);
        }
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
