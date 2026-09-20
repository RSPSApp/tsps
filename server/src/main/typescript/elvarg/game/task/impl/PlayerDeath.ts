import { GameConstants } from "../../GameConstants";
import { CombatFactory } from "../../content/combat/CombatFactory";
import { ItemDefinition } from "../../definition/ItemDefinition";
import { ItemOnGroundManager } from "../../entity/impl/grounditem/ItemOnGroundManager";
import { Player } from "../../entity/impl/player/Player";
import { PlayerRights } from "../../model/rights/PlayerRights";
import { Task } from "../Task";
import { Item } from "../../model/Item";
import { SkullType } from "../../model/SkullType";
import { PrayerData, PrayerHandler } from "../../content/PrayerHandler";
import { Skill } from "../../model/Skill";
import { Location } from "../../model/Location";
import { BrokenItem } from "../../model/BrokenItem";
import { Animation } from "../../model/Animation";
import { PluginManager } from "../../../plugins/PluginManager";
import { ItemIdentifiers } from "../../../util/ItemIdentifiers";
import { Barrows } from "../../content/combat/Barrows";

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
                    const shouldDropItemsOnDeath = this.loseItems;
                    const droppedItems: Item[] = [];
                    const deathPosition = this.player.getLocation();
                    // Always drop player bones on death, independent of item-drop policy.
                    ItemOnGroundManager.registerLocation(
                        this.killer ? this.killer : this.player,
                        new Item(ItemIdentifiers.BONES),
                        deathPosition
                    );
                    if (this.loseItems) {
                        const itemsToKeep = shouldDropItemsOnDeath
                            ? PlayerDeathTask.getItemsToKeep(this.player)
                            : [];
                        this.itemsToKeep = Array.isArray(itemsToKeep) ? itemsToKeep : [];
                        const playerItems = this.player.getInventory().getValidItems().concat(this.player.getEquipment().getValidItems());
                        const position = deathPosition;
                        let dropped = false;
                        let pluginHandledDrop = false;

                        for (let item of playerItems) {
                            const dropEligible =
                                shouldDropItemsOnDeath &&
                                (item.isTradeable() || (!item.isLostOnDeath() && Barrows.isBarrowsItem(item.getId()))) &&
                                !this.itemsToKeep.includes(item) &&
                                this.player.getRights() !== PlayerRights.OWNER &&
                                this.player.getRights() !== PlayerRights.DEVELOPER;
                            const deathDropEvent = {
                                player: this.player,
                                killer: this.killer ?? null,
                                item,
                                location: position,
                                shouldDropItems: shouldDropItemsOnDeath,
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

                            if (!shouldDropItemsOnDeath) {
                                // Remove all carried items on death without ground spawns.
                                continue;
                            }
                            // Keep tradeable items
                            if (
                                item.isLostOnDeath() ||
                                (!item.isTradeable() && !Barrows.isBarrowsItem(item.getId())) ||
                                this.itemsToKeep.includes(item)
                            ) {
                                if (!item.isLostOnDeath() && !this.itemsToKeep.includes(item)) {
                                    this.itemsToKeep.push(item);
                                }
                                continue;
                            }
                            // Don't drop items if we're owner or dev
                            if (this.player.getRights() === PlayerRights.OWNER || this.player.getRights() === PlayerRights.DEVELOPER) {
                                break;
                            }

                            droppedItems.push(item);

                            if (shouldDropItemsOnDeath) {
                                // Drop item
                                ItemOnGroundManager.registerLocation(
                                    this.killer ? this.killer : this.player,
                                    item,
                                    position
                                );
                                dropped = true;
                            }
                        }

                        // Handle defeat..
                        if (this.killer) {
                            if (shouldDropItemsOnDeath && !dropped && !pluginHandledDrop) {
                                this.killer.sendMessage(`${this.player.getUsername()} had no valuable items to be dropped.`);
                            }
                        }

                        // Reset items
                        this.player.getInventory().resetItems().refreshItems();
                        this.player.getEquipment().resetItems().refreshItems();
                    }
                    // Restore the player's default attributes (such as stats)..
                    this.player.resetAttributes();

                    // If the player lost items..
                    if (this.loseItems) {
                        // Handle items kept on death..
                        if (this.itemsToKeep.length > 0) {
                            for (const it of this.itemsToKeep) {
                                let id = it.getId();
                                const brokenItem = BrokenItem.get(id);
                                if (brokenItem != null) {
                                    id = brokenItem.getBrokenItem();
                                    this.player.sendMessage(`Your ${ItemDefinition.forId(it.getId()).getName()} has been broken. You can fix it by talking to Perdu.`);
                                }
                                this.player.getInventory().adds(id, it.getAmount());
                            }
                            this.itemsToKeep.length = 0;
                        }
                    }

                    // Notify defeat hooks for all deaths so plugins can apply
                    // post-death cleanup even when no killer is present.
                    PluginManager.emitPlayerDefeated(this.killer ?? null, this.player);
                    (this.player as any).__recentDeathDamagerEntries = null;

                    const handledDeath = PluginManager.emitPlayerDeath({
                        player: this.player,
                        killer: this.killer ?? null,
                        handled: false,
                    });

                    if (!handledDeath) {
                        const botRespawn = this.resolveBotRespawnLocation();
                        this.player.moveTo(botRespawn ?? GameConstants.DEFAULT_LOCATION);
                    }

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

                    // Handle retribution prayer effect on our killer, if present..
                    if (PrayerHandler.isActivated(this.player, PrayerHandler.RETRIBUTION)) {
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

    private static getItemsToKeep(player: Player): Item[] {
        const items: Item[] = [];
        for (const item of [...player.getInventory().getItems(), ...player.getEquipment().getItems()]) {
            if (
                item == null ||
                item.getId() <= 0 ||
                item.getAmount() <= 0 ||
                !item.isTradeable()
            ) {
                continue;
            }
            if (PluginManager.emitShouldKeepItemOnDeath(player, item) === false) {
                continue;
            }
            items.push(item);
        }

        items.sort((a: Item, b: Item) => b.getDefinition().getValue() - a.getDefinition().getValue());
        return items.slice(0, PlayerDeathTask.getAmountToKeep(player));
    }
}
