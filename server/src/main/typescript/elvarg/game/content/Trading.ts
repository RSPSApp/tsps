import { GameConstants } from "../GameConstants";
import { ItemDefinition } from "../definition/ItemDefinition";
import { ItemOnGroundManager } from "../entity/impl/grounditem/ItemOnGroundManager";
import { Player } from "../entity/impl/player/Player";
import { Item } from "../model/Item";
import { PlayerStatus } from "../model/PlayerStatus";
import { SecondsTimer } from "../model/SecondsTimer";
import { ItemContainer } from "../model/container/ItemContainer";
import { StackType } from "../model/container/StackType";
import { Inventory } from "../model/container/impl/Inventory";
import { Misc } from "../../util/Misc";
import { PluginManager } from "../../plugins/PluginManager";
import { encodeChatMessage, encodeTradeClose, encodeTradeOpen, encodeTradeRequest, encodeTradeUpdate, TradePartyView } from "../../net/protocol/ClientProtocol";

const ATTR_SKIP_PERSISTENCE = "bot-skip-persistence";

class PlayerItemContainer extends ItemContainer {
    constructor(player, private readonly execFunc: Function) {
      super(player);
    }
  
    stackType() {
      return StackType.DEFAULT;
    }
  
    refreshItems(): ItemContainer {
      this.execFunc();
      return this;
    }
  
    full(): ItemContainer {
      this.player.sendMessage("You cannot trade more items.");
      return this;
    }
  
    capacity() {
      return 28;
    }
  }

export class Trading {
    public static readonly INVENTORY_CONTAINER_INTERFACE: number = 3322;
    private static readonly OFFER_INTERFACE = 335;
    private static readonly CONFIRM_INTERFACE = 334;
    private static readonly INVENTORY_INTERFACE = 336;
    private static readonly TRADE_REQUEST_CHAT_TYPE = 101;

    // Text components the cache trade scripts leave to the server.
    private static readonly OFFER_FREE_SLOTS = (Trading.OFFER_INTERFACE << 16) | 9;
    private static readonly OFFER_OWN_HEADING = (Trading.OFFER_INTERFACE << 16) | 24;
    private static readonly OFFER_OTHER_HEADING = (Trading.OFFER_INTERFACE << 16) | 27;
    private static readonly OFFER_STATUS = (Trading.OFFER_INTERFACE << 16) | 30;
    private static readonly OFFER_TITLE = (Trading.OFFER_INTERFACE << 16) | 31;
    private static readonly CONFIRM_TITLE = (Trading.CONFIRM_INTERFACE << 16) | 4;
    private static readonly CONFIRM_OWN_HEADING = (Trading.CONFIRM_INTERFACE << 16) | 23;
    private static readonly CONFIRM_OTHER_HEADING = (Trading.CONFIRM_INTERFACE << 16) | 24;
    private static readonly CONFIRM_STATUS = (Trading.CONFIRM_INTERFACE << 16) | 30;

    // Nonstatic
    private player: Player;
    private container: ItemContainer;
    private interact: Player;
    private state: TradeState = TradeState.NONE;

    // Delays!!
    private button_delay: SecondsTimer = new SecondsTimer();
    private request_delay: SecondsTimer = new SecondsTimer();

    constructor(player: Player) {
        this.player = player;
        this.container = new PlayerItemContainer(player, ()=> {
                player.getPacketSender().sendItemContainer(player.getInventory(), Trading.INVENTORY_CONTAINER_INTERFACE);
                this.sendState(false);
                this.interact?.getTrading().sendState(false);
                return this;
        });
    }

    static listItems(items: ItemContainer): string {
        const lines = items.getValidItems().map((item) => {
            const amount = item.getAmount();
            const formatted = amount >= 1_000_000_000
                ? `@gre@${Math.floor(amount / 1_000_000_000)} billion @whi@(${Misc.format(amount)})`
                : amount >= 1_000_000
                    ? `@gre@${Math.floor(amount / 1_000_000)} million @whi@(${Misc.format(amount)})`
                    : amount >= 1_000
                        ? `@cya@${Math.floor(amount / 1_000)}K @whi@(${Misc.format(amount)})`
                        : Misc.format(amount);
            return `${item.getDefinition().getName().replace(/_/g, " ")} x @red@${formatted}`;
        });
        return lines.join("\n") || "Absolutely nothing!";
    }

    private static validate(player: Player, interact: Player, playerStatus: PlayerStatus, ...tradeState: TradeState[]): boolean {
        if (player == null || interact == null) {
            return false;
        }
        if (player.getStatus() != playerStatus) {
            return false;
        }
        if (interact.getStatus() != playerStatus) {
            return false;
        }
        if (player.getTrading().getInteract() == null || player.getTrading().getInteract() != interact) {
            return false;
        }
        if (interact.getTrading().getInteract() == null || interact.getTrading().getInteract() != player) {
            return false;
        }
        let found = false;
        for (let duelState of tradeState) {
            if (player.getTrading().getState() == duelState) {
                found = true;
                break;
            }
        }
        if (!found) {
            return false;
        }
        found = false;
        for (let duelState of tradeState) {
            if (interact.getTrading().getState() == duelState) {
                found = true;
                break;
            }
        }
        if (!found) {
            return false;
        }
        return true;
    }

    public requestTrade(t_: Player) {
        if (this.state == TradeState.NONE || this.state == TradeState.REQUESTED_TRADE) {
            if (!this.request_delay.finished()) {
                let seconds = this.request_delay.secondsRemaining();
                this.player.sendMessage("You must wait another " + (seconds == 1 ? "second" : "" + seconds + " seconds")
                        + " before sending more trade requests.");
                return;
            }

            // Cache the interact...
            let interact_: Player = this.interact;
            let t_state = t_.getTrading().getState();
            let initiateTrade = false;
            this.setInteract(t_);
            this.setState(TradeState.REQUESTED_TRADE);
            if (t_state == TradeState.REQUESTED_TRADE) {
                if (t_.getTrading().getInteract() != null && t_.getTrading().getInteract() == this.player) {
                    initiateTrade = true;
                }
            }
            if (initiateTrade) {
                this.player.getTrading().initiateTrade();
                t_.getTrading().initiateTrade();
            } else {
                this.player.sendMessage("You've sent a trade request to " + t_.getUsername() + ".");
                // The client shows "<name> wishes to trade with you." and makes it clickable.
                t_.getSession().sendClientPacket(encodeChatMessage(
                    "trade", "wishes to trade with you.", this.player.getUsername(), "",
                    this.player.getIndex(), Trading.TRADE_REQUEST_CHAT_TYPE,
                ));
                t_.getSession().sendClientPacket(encodeTradeRequest(this.player.getIndex(), this.player.getUsername()));
                if (t_.isPlayerBot && t_.isPlayerBot()) {
                    // Player Bots: Automatically accept any trade request
                    (t_ as any).getTradingInteraction?.().acceptTradeRequest?.(this.player);
                }
            }
            this.request_delay.start(2);
        } else {
            this.player.sendMessage("You cannot do that right now.");
        }
    }

    public initiateTrade() {
        this.player.setStatus(PlayerStatus.TRADING);
        this.setState(TradeState.TRADE_SCREEN);
        this.container.resetItems();
        this.container.refreshItems();
        const sender = this.player.getPacketSender();
        this.player.setInterfaceId(Trading.OFFER_INTERFACE);
        sender.sendSubInterface((161 << 16) | 16, Trading.OFFER_INTERFACE, 0)
            .sendSubInterface((161 << 16) | 79, Trading.INVENTORY_INTERFACE, 1)
            .sendInterfaceScript(3617, [Trading.INVENTORY_INTERFACE << 16])
            .sendInterfaceFlagsRange(Trading.INVENTORY_INTERFACE << 16, 0, 27, 1181694)
            .sendInterfaceFlagsRange((Trading.OFFER_INTERFACE << 16) | 25, 0, 27, 1181694)
            .sendInterfaceFlagsRange((Trading.OFFER_INTERFACE << 16) | 28, 0, 27, 1 << 10)
            .sendItemContainer(this.player.getInventory(), Trading.INVENTORY_CONTAINER_INTERFACE);
        this.sendState(true);
        this.sendText(true);
        if (this.player.isPlayerBot && this.player.isPlayerBot()) {
            (this.player as any).getTradingInteraction?.().addItemsToTrade?.(this.container, this.interact);
        }
    }

    /**
     * Ends the trade for both players, returning each one's offered items.
     * Used for declines, closing the interface and logging out.
     */
    public closeTrade() {
        if (this.state == TradeState.NONE) {
            return;
        }
        const partner = this.interact;
        this.abort("Trade declined.");
        if (partner != null && partner.getTrading().getInteract() == this.player
            && partner.getTrading().getState() >= TradeState.TRADE_SCREEN) {
            partner.getTrading().abort("Other player declined trade.");
        }
    }

    private abort(message: string) {
        this.player.getSession().sendClientPacket(encodeTradeClose(message));
        const inventory = this.player.getInventory();
        let dropped = false;
        this.container.getItems().forEach((item, slot) => {
            if (item == null || item.getId() <= 0 || item.getAmount() <= 0) return;
            if (Trading.canHold(inventory, item)) {
                this.container.switchItem(inventory, item.clone(), false, slot, false);
            } else {
                // resetAttributes clears the container below.
                ItemOnGroundManager.registers(this.player, item.clone());
                dropped = true;
            }
        });
        inventory.refreshItems();
        this.resetAttributes();
        this.player.sendMessage(message);
        if (dropped) {
            this.player.sendMessage("Your inventory is full, so some of your offered items were dropped on the floor.");
        }
        this.player.getPacketSender().sendInterfaceRemoval();
    }

    public acceptTrade() {
        if (!Trading.validate(this.player, this.interact, PlayerStatus.TRADING, TradeState.TRADE_SCREEN,
            TradeState.ACCEPTED_TRADE_SCREEN, TradeState.CONFIRM_SCREEN, TradeState.ACCEPTED_CONFIRM_SCREEN
        )) {
            return;
        }
        if (!this.button_delay.finished()) {
            return;
        }
        let interact_: Player = this.interact;
        let t_state = interact_.getTrading().getState();
        if (this.state == TradeState.TRADE_SCREEN) {
            let slotsNeeded = 0;
            for (let t of this.container.getValidItems()) {
                slotsNeeded += t.getDefinition().isStackable() && this.interact.getInventory().contains(t.getId()) ? 0 : 1;
            }
            let freeSlots = this.interact.getInventory().getFreeSlots();
            if (slotsNeeded > freeSlots) {
                this.player.sendMessage("");
                this.player.sendMessage("@or3@" + this.interact.getUsername() + " will not be able to hold that item.");
                this.player.sendMessage(
                    "@or3@They have " + freeSlots + " free inventory slot" + (freeSlots == 1 ? "." : "s."));

                this.interact.sendMessage("Trade cannot be accepted, you don't have enough free inventory space.");
                return;
            }
            this.state = (TradeState.ACCEPTED_TRADE_SCREEN);
            this.sendState(false);
            interact_.getTrading().sendState(false);

            if (this.state == TradeState.ACCEPTED_TRADE_SCREEN && t_state == TradeState.ACCEPTED_TRADE_SCREEN) {
                this.player.getTrading().confirmScreen();
                interact_.getTrading().confirmScreen();
            } else {
                if (interact_.isPlayerBot && interact_.isPlayerBot()) {
                    (interact_ as any).getTradingInteraction?.().acceptTrade?.();
                }
            }
        } else if (this.state === TradeState.CONFIRM_SCREEN) {
            // Both are in the same state. Do the second-stage accept.
            this.state = (TradeState.ACCEPTED_CONFIRM_SCREEN);
            this.sendState(false);
            interact_.getTrading().sendState(false);
            if (this.state === TradeState.ACCEPTED_CONFIRM_SCREEN && t_state === TradeState.ACCEPTED_CONFIRM_SCREEN) {
                // Give items to both players...
                const receivingItems = interact_.getTrading().getContainer().getValidItems();
                for (const item of receivingItems) {
                    this.player.getInventory().addItem(item);
                }
                const givingItems = this.player.getTrading().getContainer().getValidItems();
                for (const item of givingItems) {
                    interact_.getInventory().addItem(item);
                }
                // Let plugins react to the finished trade before the save below,
                // so anything they change (such as converting a traded bond to
                // its untradeable form) is persisted with the trade.
                PluginManager.emitTradeCompleted({
                    player: this.player,
                    partner: interact_,
                    received: receivingItems,
                    given: givingItems,
                });
                PluginManager.emitTradeCompleted({
                    player: interact_,
                    partner: this.player,
                    received: givingItems,
                    given: receivingItems,
                });
                // Save both at once, so a crash can't leave one save from
                // before the trade and the other from after it.
                Trading.save(this.player);
                Trading.save(interact_);
                if (this.player.isPlayerBot && this.player.isPlayerBot() && receivingItems.length > 0) {
                    (this.player as any).getTradingInteraction?.().receivedItems?.(receivingItems, interact_);
                }
                // Reset attributes for both players...
                this.resetAttributes();
                interact_.getTrading().resetAttributes();
                this.player.getSession().sendClientPacket(encodeTradeClose("Trade accepted!"));
                interact_.getSession().sendClientPacket(encodeTradeClose("Trade accepted!"));
                // Send interface removal for both players...
                this.player.getPacketSender().sendInterfaceRemoval();
                interact_.getPacketSender().sendInterfaceRemoval();
                // Send successful trade message!
                this.player.sendMessage("Trade accepted!");
                interact_.sendMessage("Trade accepted!");
            }
        } else {
            if (interact_.isPlayerBot && interact_.isPlayerBot()) {
                (interact_ as any).getTradingInteraction?.().acceptTrade?.();
            }
        }
        this.button_delay.start(1);
    }

    private confirmScreen() {
        // Update state
        this.state = TradeState.CONFIRM_SCREEN;
        this.sendState(true);

        this.player.setInterfaceId(Trading.CONFIRM_INTERFACE);
        this.player.getPacketSender()
            .sendSubInterface((161 << 16) | 16, Trading.CONFIRM_INTERFACE, 0)
            .sendSubInterface((161 << 16) | 79, 149, 1);
        this.sendText(true);

    }

    handleItem(id: number, amount: number, slot: number, from: ItemContainer, to: ItemContainer) {
        if (this.player.getInterfaceId() === Trading.OFFER_INTERFACE) {

            // Validate this trade action..
            if (!Trading.validate(this.player, this.interact, PlayerStatus.TRADING,
                TradeState.TRADE_SCREEN, TradeState.ACCEPTED_TRADE_SCREEN)) {
                return;
            }

            // Check if the trade was previously accepted (and now modified)...
            let modified = false;
            if (this.state === TradeState.ACCEPTED_TRADE_SCREEN) {
                this.state = TradeState.TRADE_SCREEN;
                modified = true;
            }
            if (this.interact.getTrading().getState() === TradeState.ACCEPTED_TRADE_SCREEN) {
                this.interact.getTrading().setState(TradeState.TRADE_SCREEN);
                modified = true;
            }
            if (modified) {
                this.sendState(false);
                this.interact.getTrading().sendState(false);
            }
            if (this.state === TradeState.TRADE_SCREEN && this.interact.getTrading().getState() === TradeState.TRADE_SCREEN) {

                // Check if the item is in the right place
                const offered = from.getItems()[slot];
                if (offered.getId() === id) {

                    if (!offered.isTradeable()) {
                        this.player.sendMessage("You cannot trade that item.");
                        return;
                    }

                    // Make sure we can fit that amount in the trade
                    if (from instanceof Inventory) {
                        if (!ItemDefinition.forId(id).isStackable()) {
                            if (amount > this.container.getFreeSlots()) {
                                amount = this.container.getFreeSlots();
                            }
                        }
                    }

                    if (amount <= 0) {
                        return;
                    }

                    Trading.moveItems(from, to, slot, amount);

                    if (this.interact.isPlayerBot && this.interact.isPlayerBot()) {
                        // Automatically accept the trade whenever an item is added by the player
                        this.interact.getTrading().acceptTrade();
                    }
                }
            } else {
                this.player.getPacketSender().sendInterfaceRemoval();
            }
        }
    }

    /**
     * Moves up to `amount` of the item in `slot`, slot by slot, so each item
     * keeps its own metadata (charges, contents). A stack moves only from the
     * clicked slot; unstackable items start there and continue through the
     * other tradeable slots holding the same item.
     */
    private static moveItems(from: ItemContainer, to: ItemContainer, slot: number, amount: number): void {
        const clicked = from.getItems()[slot];
        const id = clicked.getId();
        if (clicked.getDefinition().isStackable()) {
            const moving = clicked.clone().setAmount(Math.min(amount, clicked.getAmount()));
            from.switchItem(to, moving, false, slot, false);
        } else {
            const slots = [slot, ...from.getItems().map((_, index) => index).filter((index) => index !== slot)];
            let moved = 0;
            for (const index of slots) {
                if (moved >= amount || to.getFreeSlots() <= 0) break;
                const item = from.getItems()[index];
                if (item.getId() !== id || !item.isTradeable()) continue;
                from.switchItem(to, item.clone(), false, index, false);
                moved++;
            }
        }
        from.refreshItems();
        to.refreshItems();
    }

    /** Whether `item` fits: a free slot, or a stack of the same item and metadata. */
    private static canHold(container: ItemContainer, item: Item): boolean {
        if (container.getFreeSlots() > 0) return true;
        if (!item.getDefinition().isStackable()) return false;
        const meta = JSON.stringify(item.getMeta() ?? null);
        return container.getItems().some((held) => held != null && held.getId() === item.getId()
            && JSON.stringify(held.getMeta() ?? null) === meta);
    }

    private static save(player: Player): void {
        if (player.getAttribute?.(ATTR_SKIP_PERSISTENCE) === true) return;
        try {
            GameConstants.PLAYER_PERSISTENCE.save(player, "trade");
        } catch (err) {
            console.error(`[trade] Failed to save ${player.getUsername()} after a trade`, err);
        }
    }

    resetAttributes() {
        // Reset trade attributes
        this.setInteract(null);
        this.setState(TradeState.NONE);

        // Reset player status if it's trading.
        if (this.player.getStatus() === PlayerStatus.TRADING) {
            this.player.setStatus(PlayerStatus.NONE);
        }

        // Reset container..
        this.container.resetItems();

    }

    getState(): TradeState {
        return this.state;
    }

    setState(state: TradeState) {
        this.state = state;
    }

    getButtonDelay(): SecondsTimer {
        return this.button_delay;
    }

    getInteract(): Player {
        return this.interact;
    }

    setInteract(interact: Player) {
        this.interact = interact;
    }

    getContainer(): ItemContainer {
        return this.container;
    }

    private party(player: Player): TradePartyView {
        const trading = player.getTrading();
        return {
            playerId: player.getIndex(), name: player.getUsername(),
            accepted: trading.getState() === TradeState.ACCEPTED_TRADE_SCREEN,
            confirmAccepted: trading.getState() === TradeState.ACCEPTED_CONFIRM_SCREEN,
            offers: trading.getContainer().getItems().flatMap((item, slot) =>
                item?.getId?.() >= 0 && item?.getAmount?.() > 0
                    ? [{ slot, itemId: item.getId(), quantity: item.getAmount() }]
                    : []
            ),
        };
    }

    private sendState(open: boolean): void {
        if (!this.interact) return;
        const sessionId = [this.player.getIndex(), this.interact.getIndex()].sort((a, b) => a - b).join(":");
        const stage = this.state >= TradeState.CONFIRM_SCREEN ? "confirm" : "offer";
        this.player.getSession().sendClientPacket((open ? encodeTradeOpen : encodeTradeUpdate)(
            sessionId, stage, this.party(this.player), this.party(this.interact)
        ));
        if (!open) {
            this.sendText(false);
        }
    }

    /**
     * Sends the headings, values and status line. `opened` forgets the text
     * sent to the last trade window, which the client has reset.
     */
    private sendText(opened: boolean): void {
        const other = this.interact;
        if (!other) return;
        const name = other.getUsername();
        const otherState = other.getTrading().getState();
        const texts: Array<[number, string]> = this.state >= TradeState.CONFIRM_SCREEN
            ? [
                [Trading.CONFIRM_TITLE, `Trading with: ${name}`],
                [Trading.CONFIRM_OWN_HEADING, `You are about to give:<br>${Trading.formatValue(this.container)}`],
                [Trading.CONFIRM_OTHER_HEADING, `In return you will receive:<br>${Trading.formatValue(other.getTrading().getContainer())}`],
                [Trading.CONFIRM_STATUS, Trading.statusText(
                    this.state === TradeState.ACCEPTED_CONFIRM_SCREEN,
                    otherState === TradeState.ACCEPTED_CONFIRM_SCREEN,
                    "Are you sure you want to make this trade?",
                )],
            ]
            : [
                [Trading.OFFER_TITLE, `Trading with: ${name}`],
                [Trading.OFFER_OWN_HEADING, `You offer:<br>${Trading.formatValue(this.container)}`],
                [Trading.OFFER_OTHER_HEADING, `${name} offers:<br>${Trading.formatValue(other.getTrading().getContainer())}`],
                [Trading.OFFER_FREE_SLOTS, Trading.freeSlotsText(name, other.getInventory().getFreeSlots())],
                [Trading.OFFER_STATUS, Trading.statusText(
                    this.state === TradeState.ACCEPTED_TRADE_SCREEN,
                    otherState === TradeState.ACCEPTED_TRADE_SCREEN,
                    "",
                )],
            ];
        const sender = this.player.getPacketSender();
        for (const [uid, text] of texts) {
            if (opened) this.player.getFrameUpdater().clear(uid);
            sender.sendString(text, uid);
        }
    }

    private static formatValue(items: ItemContainer): string {
        const value = items.getValidItems()
            .reduce((total, item) => total + item.getDefinition().getValue() * item.getAmount(), 0);
        return `(Value: <col=ffffff>${Misc.format(value)}</col> coins)`;
    }

    private static freeSlotsText(name: string, freeSlots: number): string {
        return `${name} has ${freeSlots} free inventory slot${freeSlots === 1 ? "" : "s"}.`;
    }

    private static statusText(accepted: boolean, otherAccepted: boolean, idle: string): string {
        if (accepted && !otherAccepted) return "Waiting for other player...";
        if (!accepted && otherAccepted) return "Other player has accepted.";
        return idle;
    }
}

enum TradeState {
    NONE, REQUESTED_TRADE, TRADE_SCREEN, ACCEPTED_TRADE_SCREEN, CONFIRM_SCREEN, ACCEPTED_CONFIRM_SCREEN
}
