import { Dialogue } from "../Dialogue";
import { Player } from "../../../../entity/impl/player/Player";

/**
 * GRAPHICBOX (633): a message beside a sprite, as OSRS shows its tutorial tips ("Different pieces of
 * equipment have different stats, ..." beside the Worn Equipment icon). Live opens it with
 * graphicbox_setbuttons (3371), the universe's pause events, graphicbox_set_graphic (3374) with the
 * graphic and its 33 x 36 size, then the text (rsprox capture MudfootsBigAdventure, rev 242.1, tick 605);
 * its text goes to the chat as a mesbox line like the other boxes. The graphic's size is the box's own per use: Daddy's
 * Home's sawmill map tip sends graphic 1698 at 32 x 32 (rsprox capture DaddysHome, rev 242.1, tick 1791).
 */
export class GraphicStatementDialogue extends Dialogue {
    private static readonly GROUP_ID = 633;
    private static readonly UNIVERSE_UID = (GraphicStatementDialogue.GROUP_ID << 16) | 0;
    private static readonly TEXT_UID = (GraphicStatementDialogue.GROUP_ID << 16) | 3;
    private static readonly SET_BUTTONS_SCRIPT = 3371;
    private static readonly SET_GRAPHIC_SCRIPT = 3374;
    private static readonly GRAPHIC_WIDTH = 33;
    private static readonly GRAPHIC_HEIGHT = 36;
    private static readonly PAUSE_BUTTON = 1;
    private graphicId: number;
    private text: string;
    private width: number;
    private height: number;

    constructor(index: number, graphicId: number, text: string,
        width = GraphicStatementDialogue.GRAPHIC_WIDTH, height = GraphicStatementDialogue.GRAPHIC_HEIGHT) {
        super(index);
        this.graphicId = graphicId;
        this.text = text;
        this.width = width;
        this.height = height;
    }

    public getGraphicId(): number {
        return this.graphicId;
    }

    public getText(): string {
        return this.text;
    }

    send(player: Player) {
        GraphicStatementDialogue.send(player, this.graphicId, this.text, this.width, this.height);
    }

    /** Opens the graphic box, its text going to the chat first. */
    static send(player: Player, graphicId: number, text: string,
        width = GraphicStatementDialogue.GRAPHIC_WIDTH, height = GraphicStatementDialogue.GRAPHIC_HEIGHT) {
        Dialogue.sendBoxChatLine(player, text);
        player.getPacketSender()
            .sendChatboxInterface(GraphicStatementDialogue.GROUP_ID)
            .sendClientScript(GraphicStatementDialogue.SET_BUTTONS_SCRIPT, "Click here to continue")
            .sendInterfaceFlagsRange(GraphicStatementDialogue.UNIVERSE_UID, 0, 1, GraphicStatementDialogue.PAUSE_BUTTON)
            .sendClientScript(GraphicStatementDialogue.SET_GRAPHIC_SCRIPT, graphicId, width, height)
            .sendString(text, GraphicStatementDialogue.TEXT_UID);
    }
}
