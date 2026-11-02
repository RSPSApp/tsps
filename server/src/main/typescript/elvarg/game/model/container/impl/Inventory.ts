import { Player } from "../../../entity/impl/player/Player";
import { StackType } from "../StackType";
import { ItemContainer } from "../ItemContainer";

export class Inventory extends ItemContainer {
  public static readonly INTERFACE_ID: number = 3214;

  constructor(public player: Player) {
    super(player);
  }

  public capacity(): number {
    return 28;
  }

  public stackType(): StackType {
    return StackType.DEFAULT;
  }

  public refreshItems(): ItemContainer {
    // The bank inventory's Wield/Wear labels follow the slots (lazy: Bank imports Inventory).
    const { Bank } = require("./Bank") as typeof import("./Bank");
    if (this.getPlayer().getInterfaceId?.() === Bank.MAIN_INTERFACE_ID) Bank.sendSideOps(this.getPlayer());
    this.getPlayer()
      .getPacketSender()
      .sendItemContainer(this, Inventory.INTERFACE_ID);
    return this;
  }

  public full(itemId?: number): ItemContainer {
    this.getPlayer().sendMessage("Not enough space in your inventory.");
    return this;
  }
}
