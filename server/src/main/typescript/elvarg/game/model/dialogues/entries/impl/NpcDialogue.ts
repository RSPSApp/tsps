import { Dialogue } from "../Dialogue";
import { Player } from "../../../../entity/impl/player/Player";
import { DialogueExpression } from "../../DialogueExpression";
import { NpcDefinition } from "../../../../definition/NpcDefinition";
import { NpcChatheadAnimations } from "../../../../definition/NpcChatheadAnimations";

export class NpcDialogue extends Dialogue {
    private static readonly GROUP_ID = 231;
    private npcId: number;
    private text: string;


    constructor(index: number, npcId: number, text: string,
        private speakerName?: string, private expression: number | DialogueExpression = DialogueExpression.CALM,
        private groupId = NpcDialogue.GROUP_ID) {
        super(index);
        this.npcId = npcId;
        this.text = text;
    }
    public getNpcId(): number {
        return this.npcId;
    }

    public getText(): string {
        return this.text;
    }

    public send(player: Player): void {
        const sender = player.getPacketSender();
        const headUid = (this.groupId << 16) | 2;
        const name = this.speakerName ?? (NpcDefinition.forId(this.npcId)?.getName()?.replace(/_/g, " ") || "");
        Dialogue.sendDialogueChatLine(player, name, this.text);
        sender
            .sendChatboxInterface(this.groupId)
            .sendNpcHeadOnInterface(this.npcId, headUid)
            .sendInterfaceAnimation(headUid, NpcChatheadAnimations.forLine(this.npcId,
                typeof this.expression === "number" ? this.expression : this.expression.getExpression()))
            .sendString(
                name,
                (this.groupId << 16) | 4
            );
        NpcDialogue.sendChatText(player, this.text, (this.groupId << 16) | 6, (this.groupId << 16) | 5);
    }

    /** The line with its "Click here to continue" held back: blank and not clickable (a cutscene's camera move). */
    public sendHeld(player: Player): void {
        this.send(player);
        const continueUid = (this.groupId << 16) | 5;
        player.getPacketSender()
            .sendString("", continueUid)
            .sendInterfaceFlagsRange(continueUid, -1, -1, 0);
    }

}
