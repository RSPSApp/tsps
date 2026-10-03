import { Dialogue } from "../Dialogue";
import { Player } from "../../../../entity/impl/player/Player";
import { DialogueExpression } from "../../DialogueExpression";

export class PlayerDialogue extends Dialogue {
    // CHAT_RIGHT, confirmed against the active cache (scripts/dump-widget.ts 217).
    private static readonly GROUP_ID = 217;
    private static readonly HEAD_UID = (PlayerDialogue.GROUP_ID << 16) | 2;
    private static readonly NAME_UID = (PlayerDialogue.GROUP_ID << 16) | 4;
    private static readonly TEXT_UID = (PlayerDialogue.GROUP_ID << 16) | 6;
    private static readonly CONTINUE_UID = (PlayerDialogue.GROUP_ID << 16) | 5;
    private text: string;
    private expression: DialogueExpression;

    constructor(index: number, text: string, expression?: DialogueExpression) {
        super(index);
        this.text = text;
        this.expression = expression || DialogueExpression.CALM;
    }

    public getText(): string {
        return this.text;
    }

    send(player: Player) {
        PlayerDialogue.send(player, this.text, this.expression);
    }

    static send(player: Player, text: string, expression: DialogueExpression) {
        player.getPacketSender()
            .sendChatboxInterface(PlayerDialogue.GROUP_ID)
            .sendPlayerHeadOnInterface(PlayerDialogue.HEAD_UID)
            .sendInterfaceAnimation(PlayerDialogue.HEAD_UID, expression.getExpression())
            .sendString(player.getUsername(), PlayerDialogue.NAME_UID);
        PlayerDialogue.sendChatText(player, text, PlayerDialogue.TEXT_UID, PlayerDialogue.CONTINUE_UID);
    }
}
