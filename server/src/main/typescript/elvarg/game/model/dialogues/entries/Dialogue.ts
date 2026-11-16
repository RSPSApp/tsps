import { Player } from "../../../entity/impl/player/Player";
import { ChatType } from "../../../../net/protocol/ClientProtocol";
import { ChatTextLayout } from "../ChatTextLayout";

export abstract class Dialogue {
    /** The longest chat copy of a box's text; live cuts the rest off. */
    private static readonly BOX_CHAT_LINE_LIMIT = 200;
    /**
     * chat_left/chat_right text (231:6, 217:6) line heights by drawn lines. The widget's own is 16
     * (osrs-dumps chat_left.if3), and live keeps it for one and four lines, but sets 28 for two and
     * 20 for three (rsprox 236/241/242: 14180 one-line, 7531 two-line, 4423 three-line and 1862
     * four-line chat boxes, with no exception).
     */
    private static readonly CHAT_LINE_HEIGHTS: Readonly<Record<number, number>> = { 2: 28, 3: 20 };
    private static readonly CHAT_LINE_HEIGHT = 16;
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

    /**
     * The line height for chat text: lines the client wraps count too (ChatTextLayout, the
     * component's 380 pixels), so text sent without "<br>"s spreads as live's pre-broken text does.
     */
    static chatLineHeight(text: string): number {
        const lines = text ? ChatTextLayout.lineCount(text, ChatTextLayout.WIDTH) : 0;
        return Dialogue.CHAT_LINE_HEIGHTS[lines] ?? Dialogue.CHAT_LINE_HEIGHT;
    }

    protected static sendChatText(player: Player, text: string, textUid: number, continueUid: number): void {
        // Cache script 600: if_settextalign(horizontal, vertical, lineHeight, widget).
        const SET_TEXT_ALIGN = 600;
        const PAUSE_BUTTON = 1;
        const lineHeight = Dialogue.chatLineHeight(text);
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
