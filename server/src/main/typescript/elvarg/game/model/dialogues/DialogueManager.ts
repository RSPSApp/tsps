import { Player } from "../../entity/impl/player/Player";
import { DynamicDialogueBuilder } from "./builders/DynamicDialogueBuilder";
import { DialogueBuilder } from "./builders/DialogueBuilder";
import { Dialogue } from "./entries/Dialogue";
import { TestStaticDialogue } from '../../model/dialogues/builders/impl/TestStaticDialogue'
import { DialogueOption } from "./DialogueOption";
import { OptionDialogue } from "./entries/impl/OptionDialogue";
import { DialogueIdentifiers } from "../../../util/DialogueIdentifiers";

interface StaticDialogueDefinition {
    create: () => DialogueBuilder;
    startIndex: number;
}

export class DialogueManager {
    public static readonly STATIC_DIALOGUES: Map<number, StaticDialogueDefinition> = new Map([
        [DialogueIdentifiers.TEST, { create: () => new TestStaticDialogue(), startIndex: 0 }],
    ]);

    private readonly player: Player;

    /**
     * A {@link Map} which holds all of the current dialogue entries and indexes.
     */
    private dialogues: Map<number, Dialogue> = new Map<number, Dialogue>();

    /**
     * The current dialogue's index.
     */
    private index: number;

    /**
     * Creates a new {@link DialogueManager} for the given {@link Player}.
     *
     * @param player
     */
    constructor(player: Player) {
        this.player = player;
    }

    /**
     * Resets all of the attributes of the {@link DialogueManager}.
     */
    public reset() {
        this.dialogues.clear();
        this.index = -1;
    }

    public isActive(): boolean {
        return this.dialogues.has(this.index);
    }

    /** The dialogue entry currently shown, if any. */
    public getCurrent(): Dialogue | undefined {
        return this.isActive() ? this.dialogues.get(this.index) : undefined;
    }

    public canContinue(widgetId: number): boolean {
        return this.isActive() && this.player.getPacketSender().isChatboxInterface(widgetId >>> 16);
    }

    /**
     * Advances, starting the next dialogue.
     */
    public advance() {
        let current = this.dialogues.get(this.index);
        if (current == null) {
            this.reset();
            this.player.getPacketSender().sendInterfaceRemoval();
            return;
        }

        this.startDialogue(this.index + 1);
    }

    public startDialogue(index: number) {
        this.index = index;
        this.startDialogueOption();
    }

    public startStaticDialogue(id: number): boolean {
        const definition = DialogueManager.STATIC_DIALOGUES.get(id);
        if (!definition) {
            return false;
        }
        this.startDialog(definition.create(), definition.startIndex);
        return true;
    }

    public startDialogues(builder: DialogueBuilder) {
        this.startDialog(builder, 0);
    }

    public startDialog(builder: DialogueBuilder, index: number): void {
        if (builder instanceof DynamicDialogueBuilder) {
            builder.build(this.player);
        }
        this.startDialogueMap(builder.getDialogues(), index);
    }

    private startDialogueMap(entries: Map<number, Dialogue>, index: number) {
        this.reset();
        entries.forEach((value, key) => {
            this.dialogues.set(key, value);
        });
        this.index = index;
        this.startDialogueOption();
    }

    private startDialogueOption() {
        const dialogue = this.dialogues.get(this.index);
        if (!dialogue) {
            this.player.getPacketSender().sendInterfaceRemoval();
            return;
        }
        dialogue.send(this.player);
    }

    public handleOption(option: DialogueOption): void {
        const dialogue = this.dialogues.get(this.index);
        if (!(dialogue instanceof OptionDialogue)) {
            this.player.getPacketSender().sendInterfaceRemoval();
            return;
        }
        dialogue.execute(option);
    }

}
