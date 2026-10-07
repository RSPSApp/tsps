import { Dialogue } from "../Dialogue";
import { Player } from "../../../../entity/impl/player/Player";

export class StatementDialogue extends Dialogue {
    // MESSAGEBOX, confirmed against the active cache (scripts/dump-widget.ts 229).
    private static readonly GROUP_ID = 229;
    private static readonly TEXT_UID = (StatementDialogue.GROUP_ID << 16) | 3;
    private static readonly CONTINUE_UID = (StatementDialogue.GROUP_ID << 16) | 4;
    private text: string;

    constructor(index: number, text: string) {
        super(index);
        this.text = text;
    }

    public getText(): string {
        return this.text;
    }

    send(player: Player) {
        StatementDialogue.send(player, this.text);
    }

    /**
     * Opens the message box. Without `canContinue` it has no "Click here to continue", as OSRS
     * shows it while something plays out (a fade) before the player may carry on.
     */
    static send(player: Player, text: string, canContinue = true) {
        // Cache script 600: if_settextalign(horizontal, vertical, lineHeight, widget).
        const SET_TEXT_ALIGN = 600;
        const PAUSE_BUTTON = 1;
        player.getPacketSender()
            .sendChatboxInterface(StatementDialogue.GROUP_ID)
            .sendString(text, StatementDialogue.TEXT_UID)
            .sendClientScript(SET_TEXT_ALIGN, 1, 1, 0, StatementDialogue.TEXT_UID)
            .sendString(canContinue ? "Click here to continue" : "", StatementDialogue.CONTINUE_UID)
            .sendInterfaceFlagsRange(StatementDialogue.CONTINUE_UID, -1, -1, canContinue ? PAUSE_BUTTON : 0);
    }

}
