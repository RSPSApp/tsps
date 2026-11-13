import { Dialogue } from "../Dialogue";
import { Player } from "../../../../entity/impl/player/Player";

/**
 * OBJECTBOX_DOUBLE (11): a message between two items, as OSRS shows "The survival expert gives
 * you a bronze axe and a tinderbox." (component ids from the active cache, `yarn dump:widget 11`).
 */
export class DoubleItemStatementDialogue extends Dialogue {
    private static readonly GROUP_ID = 11;
    private static readonly FIRST_ITEM_UID = (DoubleItemStatementDialogue.GROUP_ID << 16) | 1;
    private static readonly TEXT_UID = (DoubleItemStatementDialogue.GROUP_ID << 16) | 2;
    private static readonly SECOND_ITEM_UID = (DoubleItemStatementDialogue.GROUP_ID << 16) | 3;
    private static readonly CONTINUE_UID = (DoubleItemStatementDialogue.GROUP_ID << 16) | 4;
    /** The items' zoom, passed in the count field. */
    private static readonly ITEM_ZOOM = 400;
    private static readonly PAUSE_BUTTON = 1;
    private firstItemId: number;
    private secondItemId: number;
    private text: string;

    constructor(index: number, firstItemId: number, secondItemId: number, text: string) {
        super(index);
        this.firstItemId = firstItemId;
        this.secondItemId = secondItemId;
        this.text = text;
    }

    public getItemIds(): [number, number] {
        return [this.firstItemId, this.secondItemId];
    }

    public getText(): string {
        return this.text;
    }

    send(player: Player) {
        DoubleItemStatementDialogue.send(player, this.firstItemId, this.secondItemId, this.text);
    }

    /** Opens the box, its text going to the chat first. */
    static send(player: Player, firstItemId: number, secondItemId: number, text: string) {
        Dialogue.sendBoxChatLine(player, text);
        player.getPacketSender()
            .sendChatboxInterface(DoubleItemStatementDialogue.GROUP_ID)
            .sendInterfaceFlagsRange(DoubleItemStatementDialogue.CONTINUE_UID, -1, -1, DoubleItemStatementDialogue.PAUSE_BUTTON)
            .sendString("Click here to continue", DoubleItemStatementDialogue.CONTINUE_UID)
            .sendItemOnInterfaces(DoubleItemStatementDialogue.FIRST_ITEM_UID, firstItemId, DoubleItemStatementDialogue.ITEM_ZOOM)
            .sendItemOnInterfaces(DoubleItemStatementDialogue.SECOND_ITEM_UID, secondItemId, DoubleItemStatementDialogue.ITEM_ZOOM)
            .sendString(text, DoubleItemStatementDialogue.TEXT_UID);
    }
}
