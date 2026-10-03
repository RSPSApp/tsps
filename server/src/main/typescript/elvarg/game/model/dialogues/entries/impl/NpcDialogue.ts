import { Dialogue } from "../Dialogue";
import { Player } from "../../../../entity/impl/player/Player";
import { DialogueExpression } from "../../DialogueExpression";
import { NpcDefinition } from "../../../../definition/NpcDefinition";

export class NpcDialogue extends Dialogue {
    private static readonly GROUP_ID = 231;
    private static readonly HEAD_UID = (NpcDialogue.GROUP_ID << 16) | 2;
    private static readonly NAME_UID = (NpcDialogue.GROUP_ID << 16) | 4;
    private static readonly TEXT_UID = (NpcDialogue.GROUP_ID << 16) | 6;
    private static readonly CONTINUE_UID = (NpcDialogue.GROUP_ID << 16) | 5;
    private npcId: number;
    private text: string;


    constructor(index: number, npcId: number, text: string) {
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
        sender
            .sendChatboxInterface(NpcDialogue.GROUP_ID)
            .sendNpcHeadOnInterface(this.npcId, NpcDialogue.HEAD_UID)
            .sendInterfaceAnimation(NpcDialogue.HEAD_UID, DialogueExpression.CALM.getExpression())
            .sendString(
                NpcDefinition.forId(this.npcId)?.getName()?.replace(/_/g, " ") || "",
                NpcDialogue.NAME_UID
            );
        NpcDialogue.sendChatText(player, this.text, NpcDialogue.TEXT_UID, NpcDialogue.CONTINUE_UID);
    }

}
