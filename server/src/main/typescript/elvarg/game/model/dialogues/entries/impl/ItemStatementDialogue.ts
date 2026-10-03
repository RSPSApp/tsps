import { Dialogue } from "../Dialogue";
import { Player } from "../../../../entity/impl/player/Player";

/** OBJECTBOX (193): a message beside an item, as OSRS shows "You collect your ore from the sack.". */
export class ItemStatementDialogue extends Dialogue {
    private static readonly GROUP_ID = 193;
    private static readonly UNIVERSE_UID = (ItemStatementDialogue.GROUP_ID << 16) | 0;
    private static readonly ITEM_UID = (ItemStatementDialogue.GROUP_ID << 16) | 1;
    private static readonly TEXT_UID = (ItemStatementDialogue.GROUP_ID << 16) | 2;
    /** objbox_setbuttons: builds the "Click here to continue" button. */
    private static readonly SET_BUTTONS_SCRIPT = 2868;
    /** The item's zoom, passed in the count field. */
    private static readonly ITEM_ZOOM = 400;
    private static readonly PAUSE_BUTTON = 1;
    private itemId: number;
    private text: string;

    constructor(index: number, itemId: number, text: string) {
        super(index);
        this.itemId = itemId;
        this.text = text;
    }

    public getItemId(): number {
        return this.itemId;
    }

    public getText(): string {
        return this.text;
    }

    send(player: Player) {
        ItemStatementDialogue.send(player, this.itemId, this.text);
    }

    static send(player: Player, itemId: number, text: string) {
        player.getPacketSender()
            .sendChatboxInterface(ItemStatementDialogue.GROUP_ID)
            .sendClientScript(ItemStatementDialogue.SET_BUTTONS_SCRIPT, "Click here to continue")
            .sendInterfaceFlagsRange(ItemStatementDialogue.UNIVERSE_UID, 0, 1, ItemStatementDialogue.PAUSE_BUTTON)
            .sendItemOnInterfaces(ItemStatementDialogue.ITEM_UID, itemId, ItemStatementDialogue.ITEM_ZOOM)
            .sendString(text, ItemStatementDialogue.TEXT_UID);
    }
}
