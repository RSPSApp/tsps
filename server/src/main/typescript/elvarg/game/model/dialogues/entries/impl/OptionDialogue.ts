import { DialogueOption } from "../../DialogueOption";
import { Dialogue } from "../Dialogue";
import { Player } from "../../../../entity/impl/player/Player";
import { DialogueOptionAction} from '../../DialogueOptionAction'

export class OptionDialogue extends Dialogue {
    private static readonly CHATBOX_INTERFACES = [13760, 2461, 2471, 2482, 2494];
    private action: DialogueOptionAction;
    private title: string;
    private options: string[];

    constructor(index: number, action: DialogueOptionAction, ...options: string[]) {
        super(index);
        this.action = action;
        this.options = options;
    }

    public getTitle(): string {
        return this.title;
    }

    public getOptions(): string[] {
        return this.options;
    }

    public execute(option: DialogueOption): void {
        if (this.action == null) {
            return;
        }
        this.action.executeOption(option);
    }

    public send(player: Player): void {
        OptionDialogue.send(player, this.title, this.options);
    }

    public static send(player: Player, title: string, options: string[]): void {
        const firstChildId = OptionDialogue.CHATBOX_INTERFACES[options.length - 1];
        player.getPacketSender().sendString(title, firstChildId - 1,);
        for (let i = 0; i < options.length; i++) {
            player.getPacketSender().sendString( options[i], firstChildId + i,);
        }
        player.getPacketSender().sendConfiguredInterface(firstChildId - 2);
    }
}
