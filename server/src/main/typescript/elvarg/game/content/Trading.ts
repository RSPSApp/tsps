import { ItemDefinition } from "../definition/ItemDefinition";
import { Player } from "../entity/impl/player/Player";
import { Item } from "../model/Item";
import { PlayerStatus } from "../model/PlayerStatus";
import { SecondsTimer } from "../model/SecondsTimer";
import { ItemContainer } from "../model/container/ItemContainer";
import { StackType } from "../model/container/StackType";
import { Inventory } from "../model/container/impl/Inventory";
import { Misc } from "../../util/Misc";
import { encodeTradeClose, encodeTradeOpen, encodeTradeRequest, encodeTradeUpdate, TradePartyView } from "../../net/protocol/ClientProtocol";

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
                t_.sendMessage(this.player.getUsername() + ":tradereq:");
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
        if (this.player.isPlayerBot && this.player.isPlayerBot()) {
            (this.player as any).getTradingInteraction?.().addItemsToTrade?.(this.container, this.interact);
        }
    }

    public closeTrade() {
        if (this.state != TradeState.NONE) {
            let interact_ = this.interact;
            this.player.getSession().sendClientPacket(encodeTradeClose("Trade declined."));
            for (let t of this.container.getValidItems()) {
                this.container.switchItems(this.player.getInventory(), t.clone(), false, false);
            }
            this.player.getInventory().refreshItems();
            this.resetAttributes();
            this.player.sendMessage("Trade declined.");
            this.player.getPacketSender().sendInterfaceRemoval();
            if (interact_ != null) {
                if (interact_.getStatus() == PlayerStatus.TRADING) {
                    if (interact_.getTrading().getInteract() != null && interact_.getTrading().getInteract() == this.player) {
                        interact_.getSession().sendClientPacket(encodeTradeClose("Trade declined."));
                        interact_.getPacketSender().sendInterfaceRemoval();
                    }
                }
            }
        }
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

                    const item = new Item(id, amount);

                    // Do the switch!
                    if (item.getAmount() === 1) {
                        from.switchItem(to, item,  false, slot, true);
                    } else {
                        from.switchItems(to, item, false, true);
                    }

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
    }
}

enum TradeState {
    NONE, REQUESTED_TRADE, TRADE_SCREEN, ACCEPTED_TRADE_SCREEN, CONFIRM_SCREEN, ACCEPTED_CONFIRM_SCREEN
}
