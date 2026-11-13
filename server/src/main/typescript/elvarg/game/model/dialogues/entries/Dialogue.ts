import { Player } from "../../../entity/impl/player/Player";
import { ChatType } from "../../../../net/protocol/ClientProtocol";

export abstract class Dialogue {
    /** The longest chat copy of a box's text; live cuts the rest off. */
    private static readonly BOX_CHAT_LINE_LIMIT = 200;
    private index: number;

    constructor(index: number) {
        this.index = index;
    }

    /**
     * A message box, item box or double item box writes its text to the chat as a mesbox line as it
     * opens: line breaks become spaces and the line stops at 200 characters. A box with no text
     * (a blank box over a fade) writes nothing.
     */
    static sendBoxChatLine(player: Player, text: string): void {
        if (!text) return;
        const line = String(text).replace(/<br>/g, " ").slice(0, Dialogue.BOX_CHAT_LINE_LIMIT);
        player.getPacketSender().sendTypedMessage(ChatType.MESBOX, line);
    }

    protected static sendChatText(player: Player, text: string, textUid: number, continueUid: number): void {
        // Cache script 600: if_settextalign(horizontal, vertical, lineHeight, widget).
        const SET_TEXT_ALIGN = 600;
        const PAUSE_BUTTON = 1;
        // Native chat_left/chat_right text widgets use 16, even when the client wraps again.
        const lineHeight = 16;
        player.getPacketSender()
            .sendString(text, textUid)
            .sendClientScript(SET_TEXT_ALIGN, 1, 1, lineHeight, textUid)
            .sendString("Click here to continue", continueUid)
            .sendInterfaceFlagsRange(continueUid, -1, -1, PAUSE_BUTTON);
    }

    abstract send(player: Player);

    getIndex(): number {
        return this.index;
    }

}
