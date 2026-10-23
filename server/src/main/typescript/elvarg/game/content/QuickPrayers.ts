import { CacheDefinitions } from "../cache/CacheDefinitions";
import { Player } from "../entity/impl/player/Player";
import { Skill } from "../model/Skill";
import type { PrayerData } from "./PrayerHandler";

export class QuickPrayers {
    private static prayerValues: PrayerData[] | null = null;
    private static get PRAYER_VALUES(): PrayerData[] {
        return this.prayerValues ??= Array.from(this.PRAYER_DATA.values());
    }
    private static get PRAYER_HANDLER(): typeof import("./PrayerHandler").PrayerHandler {
        // Loaded lazily: Player -> QuickPrayers -> PrayerHandler -> Player is a load-time cycle.
        return require("./PrayerHandler").PrayerHandler;
    }
    private static get PRAYER_DATA(): typeof import("./PrayerHandler").PrayerData {
        return require("./PrayerHandler").PrayerData;
    }
    public static get THICK_SKIN() {
        return QuickPrayers.PRAYER_HANDLER.THICK_SKIN;
    }
    public static get ROCK_SKIN() {
        return QuickPrayers.PRAYER_HANDLER.ROCK_SKIN;
    }
    public static get STEEL_SKIN() {
        return QuickPrayers.PRAYER_HANDLER.STEEL_SKIN;
    }
    public static get BURST_OF_STRENGTH() {
        return QuickPrayers.PRAYER_HANDLER.BURST_OF_STRENGTH;
    }
    public static get SUPERHUMAN_STRENGTH() {
        return QuickPrayers.PRAYER_HANDLER.SUPERHUMAN_STRENGTH;
    }
    public static get ULTIMATE_STRENGTH() {
        return QuickPrayers.PRAYER_HANDLER.ULTIMATE_STRENGTH;
    }
    public static get CLARITY_OF_THOUGHT() {
        return QuickPrayers.PRAYER_HANDLER.CLARITY_OF_THOUGHT;
    }
    public static get IMPROVED_REFLEXES() {
        return QuickPrayers.PRAYER_HANDLER.IMPROVED_REFLEXES;
    }
    public static get INCREDIBLE_REFLEXES() {
        return QuickPrayers.PRAYER_HANDLER.INCREDIBLE_REFLEXES;
    }
    public static get SHARP_EYE() {
        return QuickPrayers.PRAYER_HANDLER.SHARP_EYE;
    }
    public static get HAWK_EYE() {
        return QuickPrayers.PRAYER_HANDLER.HAWK_EYE;
    }
    public static get EAGLE_EYE() {
        return QuickPrayers.PRAYER_HANDLER.EAGLE_EYE;
    }
    public static get MYSTIC_WILL() {
        return QuickPrayers.PRAYER_HANDLER.MYSTIC_WILL;
    }
    public static get MYSTIC_LORE() {
        return QuickPrayers.PRAYER_HANDLER.MYSTIC_LORE;
    }
    public static get MYSTIC_MIGHT() {
        return QuickPrayers.PRAYER_HANDLER.MYSTIC_MIGHT;
    }
    public static get CHIVALRY() {
        return QuickPrayers.PRAYER_HANDLER.CHIVALRY;
    }
    public static get PIETY() {
        return QuickPrayers.PRAYER_HANDLER.PIETY;
    }
    public static get RIGOUR() {
        return QuickPrayers.PRAYER_HANDLER.RIGOUR;
    }
    public static get AUGURY() {
        return QuickPrayers.PRAYER_HANDLER.AUGURY;
    }
    public static get PROTECT_FROM_MAGIC() {
        return QuickPrayers.PRAYER_HANDLER.PROTECT_FROM_MAGIC;
    }
    public static get PROTECT_FROM_MISSILES() {
        return QuickPrayers.PRAYER_HANDLER.PROTECT_FROM_MISSILES;
    }
    public static get PROTECT_FROM_MELEE() {
        return QuickPrayers.PRAYER_HANDLER.PROTECT_FROM_MELEE;
    }
    public static get RETRIBUTION() {
        return QuickPrayers.PRAYER_HANDLER.RETRIBUTION;
    }
    public static get REDEMPTION() {
        return QuickPrayers.PRAYER_HANDLER.REDEMPTION;
    }
    public static get SMITE() {
        return QuickPrayers.PRAYER_HANDLER.SMITE;
    }
    public static get DEFENCE_PRAYERS() {
        return QuickPrayers.PRAYER_HANDLER.DEFENCE_PRAYERS;
    }
    public static get STRENGTH_PRAYERS() {
        return QuickPrayers.PRAYER_HANDLER.STRENGTH_PRAYERS;
    }
    public static get ATTACK_PRAYERS() {
        return QuickPrayers.PRAYER_HANDLER.ATTACK_PRAYERS;
    }
    public static get RANGED_PRAYERS() {
        return QuickPrayers.PRAYER_HANDLER.RANGED_PRAYERS;
    }
    public static get MAGIC_PRAYERS() {
        return QuickPrayers.PRAYER_HANDLER.MAGIC_PRAYERS;
    }
    public static get OVERHEAD_PRAYERS() {
        return QuickPrayers.PRAYER_HANDLER.OVERHEAD_PRAYERS;
    }

    public static canUse(player: Player, prayer: PrayerData, msg: boolean): boolean {
        return QuickPrayers.PRAYER_HANDLER.canUse(player, prayer, msg);
    }

    public static isActivated(player: Player, prayerId: number): boolean {
        return QuickPrayers.PRAYER_HANDLER.isActivated(player, prayerId);
    }

    public static activatePrayerPrayerId(player: Player, prayerId: number): void {
        QuickPrayers.PRAYER_HANDLER.activatePrayerPrayerId(player, prayerId);
    }

    public static deactivatePrayer(player: Player, prayerId: number): void {
        QuickPrayers.PRAYER_HANDLER.deactivatePrayer(player, prayerId);
    }
    private static readonly TOGGLE_QUICK_PRAYERS = 1500;
    private static readonly SETUP_BUTTON = 1506;
    private static readonly CONFIRM_BUTTON = 17232;
    private static readonly QUICK_PRAYERS_TAB_INTERFACE_ID = 17200;
    private static readonly PRAYER_WIDGET_GROUP_ID = 541;
    private static readonly QUICK_PRAYER_WIDGET_CHILD_ID = 4;
    /** The prayer orb on the desktop orbs and the mobile toplevel's (gameval names). */
    private static readonly PRAYER_ORB_COMPONENTS = ["orbs:prayerbutton", "orbs_osm:prayerbutton"];
    private static prayerOrbIds?: number[];
    private static readonly SETUP_WIDGET_GROUP_ID = 77;
    private static readonly SETUP_WIDGET_CHILD_ID = 4;
    private static readonly SETUP_DONE_CHILD_ID = 5;
    private static readonly PRAYER_ALL_ACTIVE_VARBIT = 4101;
    private static readonly QUICK_PRAYER_SELECTED_VARBIT = 4102;
    private static readonly QUICK_PRAYER_SLOT_BY_ID = [
        0, 1, 2, 18, 19, 3, 4, 5, 6, 7, 8, 20, 21, 9, 10,
        11, 12, 13, 14, 22, 23, 15, 16, 17, 28, 25, 26, 24, 27,
    ];

    private static isPrayerOrb(widgetId: number): boolean {
        QuickPrayers.prayerOrbIds ??= QuickPrayers.PRAYER_ORB_COMPONENTS
            .map((name) => CacheDefinitions.getComponentId(name))
            .filter((id): id is number => id !== null);
        return QuickPrayers.prayerOrbIds.includes(widgetId);
    }

    private player: Player;
    public prayers: PrayerData[] = Array.from(
        { length: QuickPrayers.PRAYER_VALUES.length },
        () => null
    );
    private selectingPrayers: boolean;
    private enabled: boolean;

    constructor(player: Player) {
        this.player = player;
    }

    public sendChecks(): void {
        this.player.getPacketSender().sendVarbit(
            QuickPrayers.QUICK_PRAYER_SELECTED_VARBIT,
            this.selectedPrayerMask(),
        );
    }

    private selectedPrayerMask(): number {
        let selected = 0;
        for (const [prayerId, prayer] of this.prayers.entries()) {
            if (prayer != null) selected |= 1 << QuickPrayers.QUICK_PRAYER_SLOT_BY_ID[prayerId];
        }
        return selected;
    }

    private uncheckSelect(toDeselect: number[], exception: number): void {
        for (const i of toDeselect) {
            if (i === exception) {
                continue;
            }
            this.uncheck(QuickPrayers.PRAYER_VALUES[i]);
        }
    }

    private uncheck(prayer: PrayerData): void {
        const prayerIndex = QuickPrayers.PRAYER_VALUES.indexOf(prayer);
        if (prayerIndex !== -1 && this.prayers[prayerIndex] != null) {
            this.prayers[prayerIndex] = null;
            this.sendChecks();
        }
    }

    private toggle(index: number): void {
        const prayer: PrayerData = QuickPrayers.PRAYER_VALUES[index];
        if (prayer == null) {
            return;
        }

        if (this.prayers[index] != null) {
            this.uncheck(prayer);
            return;
        }

        if (!QuickPrayers.canUse(this.player, prayer, true)) {
            this.uncheck(prayer);
            return;
        }

        this.prayers[index] = prayer;
        this.sendChecks();

        switch (index) {
            case QuickPrayers.THICK_SKIN:
            case QuickPrayers.ROCK_SKIN:
            case QuickPrayers.STEEL_SKIN:
                this.uncheckSelect(QuickPrayers.DEFENCE_PRAYERS, index);
                break;
            case QuickPrayers.BURST_OF_STRENGTH:
            case QuickPrayers.SUPERHUMAN_STRENGTH:
            case QuickPrayers.ULTIMATE_STRENGTH:
                this.uncheckSelect(QuickPrayers.STRENGTH_PRAYERS, index);
                this.uncheckSelect(QuickPrayers.RANGED_PRAYERS, index);
                this.uncheckSelect(QuickPrayers.MAGIC_PRAYERS, index);
                break;
            case QuickPrayers.CLARITY_OF_THOUGHT:
            case QuickPrayers.IMPROVED_REFLEXES:
            case QuickPrayers.INCREDIBLE_REFLEXES:
                this.uncheckSelect(QuickPrayers.ATTACK_PRAYERS, index);
                this.uncheckSelect(QuickPrayers.RANGED_PRAYERS, index);
                this.uncheckSelect(QuickPrayers.MAGIC_PRAYERS, index);
                break;
            case QuickPrayers.SHARP_EYE:
            case QuickPrayers.HAWK_EYE:
            case QuickPrayers.EAGLE_EYE:
            case QuickPrayers.MYSTIC_WILL:
            case QuickPrayers.MYSTIC_LORE:
            case QuickPrayers.MYSTIC_MIGHT:
                this.uncheckSelect(QuickPrayers.STRENGTH_PRAYERS, index);
                this.uncheckSelect(QuickPrayers.ATTACK_PRAYERS, index);
                this.uncheckSelect(QuickPrayers.RANGED_PRAYERS, index);
                this.uncheckSelect(QuickPrayers.MAGIC_PRAYERS, index);
                break;
            case QuickPrayers.CHIVALRY:
            case QuickPrayers.PIETY:
            case QuickPrayers.RIGOUR:
            case QuickPrayers.AUGURY:
                this.uncheckSelect(QuickPrayers.DEFENCE_PRAYERS, index);
                this.uncheckSelect(QuickPrayers.STRENGTH_PRAYERS, index);
                this.uncheckSelect(QuickPrayers.ATTACK_PRAYERS, index);
                this.uncheckSelect(QuickPrayers.RANGED_PRAYERS, index);
                this.uncheckSelect(QuickPrayers.MAGIC_PRAYERS, index);
                break;
            case QuickPrayers.PROTECT_FROM_MAGIC:
            case QuickPrayers.PROTECT_FROM_MISSILES:
            case QuickPrayers.PROTECT_FROM_MELEE:
                this.uncheckSelect(QuickPrayers.OVERHEAD_PRAYERS, index);
                break;
            case QuickPrayers.RETRIBUTION:
            case QuickPrayers.REDEMPTION:
            case QuickPrayers.SMITE:
                this.uncheckSelect(QuickPrayers.OVERHEAD_PRAYERS, index);
                break;
        }
    }

    public checkActive(): void {
        if (!this.enabled) return;
        for (const [prayerId, prayer] of this.prayers.entries()) {
            if ((prayer != null) !== QuickPrayers.isActivated(this.player, prayerId)) {
                this.enabled = false;
                this.player.getPacketSender().sendQuickPrayersState(false);
                return;
            }
        }
    }

    public sync(): void {
        this.sendChecks();
        this.player.getPacketSender().sendQuickPrayersState(this.enabled);
    }

    private openSetup(): void {
        this.sendChecks();
        this.player.getPacketSender()
            .sendTabInterface(5, QuickPrayers.QUICK_PRAYERS_TAB_INTERFACE_ID)
            .sendTab(5)
            .sendInterfaceFlagsRange(
                (QuickPrayers.SETUP_WIDGET_GROUP_ID << 16) | QuickPrayers.SETUP_WIDGET_CHILD_ID,
                0,
                QuickPrayers.PRAYER_VALUES.length - 1,
                1 << 1,
            );
        this.selectingPrayers = true;
    }

    private toggleQuickPrayers(): void {
        if (this.player.getSkillManager().getCurrentLevel(Skill.PRAYER) <= 0) {
            this.player.sendMessage("You don't have enough Prayer points.");
            return;
        }
        if (this.enabled) {
            QuickPrayers.PRAYER_HANDLER.deactivatePrayers(this.player);
            this.player.getPacketSender().sendVarbit(QuickPrayers.PRAYER_ALL_ACTIVE_VARBIT, 0);
            this.enabled = false;
        } else {
            const selected = this.prayers.filter((prayer): prayer is PrayerData => prayer != null);
            const blocked = selected.find((prayer) => !QuickPrayers.canUse(this.player, prayer, false));
            if (selected.length === 0) {
                this.player.sendMessage("You have not setup any quick-prayers yet.");
                this.enabled = false;
            } else if (blocked) {
                QuickPrayers.canUse(this.player, blocked, true);
                this.enabled = false;
            } else {
                QuickPrayers.PRAYER_HANDLER.deactivatePrayers(this.player);
                this.player.getPacketSender().sendVarbit(
                    QuickPrayers.PRAYER_ALL_ACTIVE_VARBIT,
                    this.selectedPrayerMask(),
                );
                for (const prayer of selected) {
                    QuickPrayers.activatePrayerPrayerId(this.player, prayer.prayerId);
                }
                this.enabled = selected.every((prayer) => QuickPrayers.isActivated(this.player, prayer.prayerId));
            }
        }
        this.player.getPacketSender().sendQuickPrayersState(this.enabled);
    }

    public handleWidgetAction(groupId: number, childId: number, buttonNum = 1, slot?: number): boolean {
        if (groupId === QuickPrayers.PRAYER_WIDGET_GROUP_ID && childId === QuickPrayers.QUICK_PRAYER_WIDGET_CHILD_ID) {
            if (buttonNum === 2) {
                this.setPrayers(QuickPrayers.PRAYER_VALUES.map((prayer, prayerId) =>
                    QuickPrayers.isActivated(this.player, prayerId) ? prayer : null,
                ));
                this.sync();
            } else this.toggleQuickPrayers();
            return true;
        }
        if (QuickPrayers.isPrayerOrb((groupId << 16) | childId)) {
            if (buttonNum === 2) this.openSetup();
            else this.toggleQuickPrayers();
            return true;
        }
        if (groupId === QuickPrayers.SETUP_WIDGET_GROUP_ID && childId === QuickPrayers.SETUP_WIDGET_CHILD_ID && slot != null) {
            const prayerId = QuickPrayers.QUICK_PRAYER_SLOT_BY_ID.indexOf(slot);
            if (prayerId === -1) return false;
            this.toggle(prayerId);
            this.enabled = false;
            this.player.getPacketSender().sendQuickPrayersState(false);
            return true;
        }
        if (groupId === QuickPrayers.SETUP_WIDGET_GROUP_ID && childId === QuickPrayers.SETUP_DONE_CHILD_ID) {
            this.player.getPacketSender().sendTabInterface(5, 5608);
            this.selectingPrayers = false;
            return true;
        }
        return false;
    }


    public handleButton(button: number): boolean {
        switch (button) {
            case QuickPrayers.TOGGLE_QUICK_PRAYERS:
                this.toggleQuickPrayers();
                break;
            case QuickPrayers.SETUP_BUTTON:
                if (this.selectingPrayers) {
                    this.player.getPacketSender().sendTabInterface(5, 5608).sendTab(5);
                    this.selectingPrayers = false;
                } else {
                    this.openSetup();
                }
                break;
            case QuickPrayers.CONFIRM_BUTTON:
                if (this.selectingPrayers) {
                    this.player.getPacketSender().sendTabInterface(5, 5608);
                    this.selectingPrayers = false;
                }
                break;
        }
        if (button >= 17202 && button <= 17230) {
            if (this.selectingPrayers) {
                const index = button - 17202;
                this.toggle(index);
            }
            return true;
        }
        return false;
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    public getPrayers(): PrayerData[] {
        return this.prayers;
    }

    public setPrayers(prayers: PrayerData[]): void {
        const normalized = Array.from(
            { length: QuickPrayers.PRAYER_VALUES.length },
            (_, index) => prayers?.[index] ?? null
        );
        this.prayers = normalized;
        this.enabled = false;
    }
}
