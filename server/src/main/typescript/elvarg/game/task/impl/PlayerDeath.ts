import { GameConstants } from "../../GameConstants";
import { MORTAL_DEVELOPER_ATTRIBUTE } from "../../entity/impl/Mobile";
import { CombatFactory } from "../../content/combat/CombatFactory";
import { ItemOnGroundManager } from "../../entity/impl/grounditem/ItemOnGroundManager";
import { Player } from "../../entity/impl/player/Player";
import { PlayerRights } from "../../model/rights/PlayerRights";
import { Task } from "../Task";
import { Item } from "../../model/Item";
import { SkullType } from "../../model/SkullType";
import { PrayerData, PrayerHandler } from "../../content/PrayerHandler";
import { Skill } from "../../model/Skill";
import { Location } from "../../model/Location";
import { Animation } from "../../model/Animation";
import { PluginManager } from "../../../plugins/PluginManager";
import { ItemIdentifiers } from "../../../util/ItemIdentifiers";
import { Barrows } from "../../content/combat/Barrows";
import { Wilderness } from "../../content/wilderness/Wilderness";

export class PlayerDeathTask extends Task {
    private player: Player;
    private killer: Player | undefined;
    private loseItems = true;
    private itemsToKeep: Item[] = [];
    private ticks = 2;


    constructor(player: Player) {
        super(1, false);
        this.player = player;
        (this.player as any).__recentDeathDamagerEntries =
            this.player.getCombat().getRecentDamagerEntries();
        this.killer = player.getCombat().getKiller(true);
    }

    private resolveBotRespawnLocation(): Location | null {
        if (!this.player?.isPlayerBot?.()) {
            return null;
        }
        const resolver = (this.player as any).__botResolveRespawnLocation;
        if (typeof resolver === "function") {
            try {
                const resolved = resolver();
                return Location.readTile(resolved);
            } catch (err) {
                console.error("[PlayerDeathTask] bot respawn resolver failed", err);
            }
        }
        return null;
    }

    public execute() {
        if (!this.player) {
            this.stop();
            return;
        }
        try {
            switch (this.ticks) {
                case 0: {
                    if (this.player.isPlayerBot && this.player.isPlayerBot()) {
                        (this.player as any).getCombatInteraction?.().handleDeath?.(this.killer);
                    }
                    const pluginShouldDropItems =
                        PluginManager.emitShouldDropItemsOnDeath(this.player, this.killer ?? null);
                    this.loseItems = pluginShouldDropItems ?? true;
                    const deathPosition = this.player.getLocation();
                    // Always drop player bones on death, independent of item-drop policy.
                    ItemOnGroundManager.registerLocation(
                        this.killer ? this.killer : this.player,
                        new Item(ItemIdentifiers.BONES),
                        deathPosition
                    );
                    if (this.loseItems) {
                        this.itemsToKeep = PlayerDeathTask.dropItems(this.player, this.killer, deathPosition);
                    }
                    // Restore the player's default attributes (such as stats)..
                    this.player.resetAttributes();

                    // If the player lost items, the ones a death keeps come back.
                    if (this.loseItems) {
                        PlayerDeathTask.returnKeptItems(this.player, this.itemsToKeep);
                        this.itemsToKeep = [];
                    }

                    // Notify defeat hooks for all deaths so plugins can apply
                    // post-death cleanup even when no killer is present.
                    PluginManager.emitPlayerDefeated(this.killer ?? null, this.player);
                    (this.player as any).__recentDeathDamagerEntries = null;

                    GameConstants.PLAYER_PERSISTENCE.requestSave(this.player, "death");
                    const handledDeath = PluginManager.emitPlayerDeath({
                        player: this.player,
                        killer: this.killer ?? null,
                        itemsLost: this.loseItems,
                        handled: false,
                    });

                    if (!handledDeath) {
                        const botRespawn = this.resolveBotRespawnLocation();
                        this.player.moveTo(botRespawn ?? GameConstants.DEFAULT_LOCATION);
                    }
                    GameConstants.PLAYER_PERSISTENCE.requestSave(this.player, "respawn");

                    // Stop the event..
                    this.stop();
                    break;
                }

                case 2: {
                    if (this.player.isPlayerBot && this.player.isPlayerBot()) {
                        (this.player as any).getCombatInteraction?.().handleDying?.(this.killer);
                    }

                    // Reset combat..
                    this.player.getCombat().reset();
                    this.player.getCombat().setUnderAttack(null);
                    this.player.setFollowing(null);
                    this.player.setMobileInteraction(null);
                    this.player.setPositionToFace(null);
                    this.player.setForceMovement(null);

                    // Reset movement queue and disable it..
                    this.player.getMovementQueue().setBlockMovement(true).reset();

                    // Mark us as untargetable..
                    this.player.setUntargetable(true);

                    // Close all open interfaces..
                    this.player.getPacketSender().sendInterfaceRemoval();

                    // Send death message..
                    this.player.sendMessage("Oh dear, you are dead!");

                    // Perform death animation..
                    this.player.performAnimation(new Animation(836));

                    // Retribution hits our killer, unless the killing blow was rebounded
                    // damage - recoil, vengeance or another Retribution (Wiki: Retribution).
                    const killingBlow = this.player.getCombat().getHitQueue().getLastAppliedHit();
                    if (PrayerHandler.isActivated(this.player, PrayerHandler.RETRIBUTION) && !killingBlow?.isReflected()) {
                        if (typeof this.killer !== 'undefined' && this.killer !== null) {
                            CombatFactory.handleRetribution(this.player, this.killer);
                        }
                    }
                    break;
                }
            }
            this.ticks--;
        } catch (e) {
            super.stop();
            console.error(e);
            this.player.resetAttributes();
            this.player.moveTo(this.resolveBotRespawnLocation() ?? GameConstants.DEFAULT_LOCATION);
        }
    }

    /**
     * A death's item loss at `position`: the items a death keeps are set aside and returned, the
     * rest go to the death-drops hooks (a grave) or the floor, and the inventory and equipment
     * are emptied. `returnKeptItems` gives the kept ones back.
     */
    public static dropItems(player: Player, killer: Player | null | undefined, position: Location): Item[] {
        const kept = PlayerDeathTask.getItemsToKeep(player);
        const itemsToKeep: Item[] = Array.isArray(kept) ? kept : [];
        const playerItems = PlayerDeathTask.splitIntoComponents(player, killer, itemsToKeep,
            player.getInventory().getValidItems().concat(player.getEquipment().getValidItems()));
        const droppedItems: Item[] = [];
        const lostUntradeables: Item[] = [];
        const layout = PlayerDeathTask.slotLayout(player);
        let dropped = false;
        let pluginHandledDrop = false;

        for (const item of playerItems) {
            const dropEligible =
                (item.isTradeable() || (!item.isLostOnDeath() && Barrows.isBarrowsItem(item.getId()))) &&
                !itemsToKeep.includes(item) &&
                !PlayerDeathTask.keepsEverything(player);
            const deathDropEvent = {
                player,
                killer: killer ?? null,
                item,
                kept: itemsToKeep.includes(item),
                location: position,
                shouldDropItems: true,
                dropEligible,
                suppressDefaultDrop: false,
                handled: false,
            };
            const handled = PluginManager.emitPlayerDeathItemDrop(deathDropEvent);
            if (handled) {
                pluginHandledDrop = true;
                continue;
            }

            if (deathDropEvent.suppressDefaultDrop && deathDropEvent.dropEligible) {
                dropped = true;
                continue;
            }

            // Owners and developers keep everything.
            if (PlayerDeathTask.keepsEverything(player)) {
                if (!item.isLostOnDeath() && !itemsToKeep.includes(item)) {
                    itemsToKeep.push(item);
                }
                continue;
            }
            if (item.isLostOnDeath() || itemsToKeep.includes(item)) {
                continue;
            }
            // Untradeables are kept unless a death-drops hook takes them (a grave).
            if (!item.isTradeable() && !Barrows.isBarrowsItem(item.getId())) {
                lostUntradeables.push(item);
                continue;
            }
            droppedItems.push(item);
        }

        // Emitted with nothing lost too: a death still changes an existing grave.
        if (!PlayerDeathTask.keepsEverything(player)) {
            const before = droppedItems.length + lostUntradeables.length;
            PluginManager.emitPlayerDeathDrops({
                player,
                killer: killer ?? null,
                location: position,
                items: droppedItems,
                untradeables: lostUntradeables,
                layout,
            });
            if (droppedItems.length + lostUntradeables.length < before) {
                pluginHandledDrop = true;
            }
        }
        for (const item of droppedItems) {
            ItemOnGroundManager.registerLocation(killer ? killer : player, item, position);
            dropped = true;
        }
        itemsToKeep.push(...lostUntradeables);

        // Handle defeat..
        if (killer && !dropped && !pluginHandledDrop) {
            killer.sendMessage(`${player.getUsername()} had no valuable items to be dropped.`);
        }

        // Reset items
        player.getInventory().resetItems().refreshItems();
        player.getEquipment().resetItems().refreshItems();
        return itemsToKeep;
    }

    /** The items a death let the player keep, back in the inventory. */
    public static returnKeptItems(player: Player, items: Item[]): void {
        for (const it of items) {
            player.getInventory().addItem(it.clone());
        }
    }

    /**
     * Loses items as a death at `position` would, without the death itself: a raid that holds
     * its dead until the whole party falls takes their items then (The Fractured Archive).
     */
    public static loseItemsAsDeath(player: Player, position: Location): void {
        PlayerDeathTask.returnKeptItems(player, PlayerDeathTask.dropItems(player, null, position));
        GameConstants.PLAYER_PERSISTENCE.requestSave(player, "death");
    }

    private static getAmountToKeep(player: Player): number {
        if (
            player.getSkullTimer() > 0 &&
            player.getSkullType() == SkullType.RED_SKULL
        ) {
            return 0;
        }
        const protectItem = player.getSkillManager().getMaxLevel(Skill.PRAYER) >= PrayerData.PROTECT_ITEM.requirement &&
            player.getSkillManager().getCurrentLevel(Skill.PRAYER) > 0 &&
            PrayerHandler.isActivated(player, PrayerHandler.PROTECT_ITEM);
        return (player.getSkullTimer() > 0 ? 0 : 3) + (protectItem ? 1 : 0);
    }

    /**
     * Killed by a player in the Wilderness, an unkept item with tradeable components (an upgraded
     * Nightmare staff: the staff and its orb, `deathComponents` in item-gameplay.json) drops as
     * those components for the killer, and the item itself is gone (Wiki).
     */
    /** The item id in each inventory and equipment slot, -1 where empty. */
    private static slotLayout(player: Player): { inventory: number[]; equipment: number[] } {
        const ids = (items: Item[]) => items.map((item) => (item && item.getId() > 0 && item.getAmount() > 0 ? item.getId() : -1));
        return {
            inventory: ids(player.getInventory().getItems()),
            equipment: ids(player.getEquipment().getItems()),
        };
    }

    /** Owners and developers keep everything, unless they made themselves mortal (::mortal). */
    private static keepsEverything(player: Player): boolean {
        const rights = player.getRights();
        return (rights === PlayerRights.OWNER || rights === PlayerRights.DEVELOPER)
            && player.getAttribute(MORTAL_DEVELOPER_ATTRIBUTE) !== true;
    }

    private static splitIntoComponents(player: Player, killer: Player | null | undefined, kept: Item[], items: Item[]): Item[] {
        if (!killer || killer === player || !Wilderness.isIn(player)) return items;
        if (PlayerDeathTask.keepsEverything(player)) return items;
        return items.flatMap((item) => {
            const components = item.getDefinition().getDeathComponents();
            if (components.length === 0 || kept.includes(item) || item.isLostOnDeath()) return [item];
            return components.map((id) => new Item(id, item.getAmount()));
        });
    }

    /** The items a death lets the player keep: the three most valuable (four with Protect Item, none skulled). */
    public static getItemsToKeep(player: Player): Item[] {
        const items: Item[] = [];
        const alwaysKept: Item[] = [];
        for (const item of [...player.getInventory().getItems(), ...player.getEquipment().getItems()]) {
            // Untradeable items compete for the kept slots too, by value (Wiki: Items Kept on
            // Death). Preset items are always lost, so they never take one.
            if (
                item == null ||
                item.getId() <= 0 ||
                item.getAmount() <= 0 ||
                item.isLostOnDeath()
            ) {
                continue;
            }
            const keep = PluginManager.emitShouldKeepItemOnDeath(player, item);
            if (keep === false) {
                continue;
            }
            // A plugin's keep=true puts the item beyond the normal keep count.
            if (keep === true) {
                alwaysKept.push(item);
                continue;
            }
            items.push(item);
        }

        items.sort((a: Item, b: Item) => b.getDefinition().getValue() - a.getDefinition().getValue());
        return [...items.slice(0, PlayerDeathTask.getAmountToKeep(player)), ...alwaysKept];
    }
}
