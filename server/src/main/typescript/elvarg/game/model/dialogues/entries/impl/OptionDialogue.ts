import { DialogueOption } from "../../DialogueOption";
import { Dialogue } from "../Dialogue";
import { Player } from "../../../../entity/impl/player/Player";
import { DialogueOptionAction} from '../../DialogueOptionAction'

export class OptionDialogue extends Dialogue {
    public static readonly OPTIONS_WIDGET_ID = (219 << 16) | 1;
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

    /** The question above the options ("Select an Option" when unset). */
    public setTitle(title: string): OptionDialogue {
        this.title = title;
        return this;
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
        const sender = player.getPacketSender();
        sender.sendInterfaceScript(2379);
        sender.sendChatboxInterface(219, true);
        sender.sendClientScript(58, title || "Select an Option", options.join("|"));
        sender.sendInterfaceFlagsRange(OptionDialogue.OPTIONS_WIDGET_ID, 1, options.length, 1);
    }
}
