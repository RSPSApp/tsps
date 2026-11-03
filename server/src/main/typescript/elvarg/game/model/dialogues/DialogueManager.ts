import { Player } from "../../entity/impl/player/Player";
import { DynamicDialogueBuilder } from "./builders/DynamicDialogueBuilder";
import { DialogueBuilder } from "./builders/DialogueBuilder";
import { Dialogue } from "./entries/Dialogue";
import { TestStaticDialogue } from '../../model/dialogues/builders/impl/TestStaticDialogue'
import { DialogueOption } from "./DialogueOption";
import { OptionDialogue } from "./entries/impl/OptionDialogue";
import { ActionDialogue } from "./entries/impl/ActionDialogue";
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
    private owner: object | undefined;

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
        this.owner = undefined;
    }

    public isActive(): boolean {
        return this.dialogues.has(this.index);
    }

    /** The dialogue entry currently shown, if any. */
    public getCurrent(): Dialogue | undefined {
        return this.isActive() ? this.dialogues.get(this.index) : undefined;
    }

    /** Opaque owner of this chain, retained across its native continuations. */
    public getOwner(): object | undefined {
        return this.isActive() ? this.owner : undefined;
    }

    public canContinue(widgetId: number): boolean {
        return this.isActive() && this.player.getPacketSender().isChatboxInterface(widgetId >>> 16);
    }

    /** Native option resumes carry their one-based choice in the child index. */
    public handleResume(widgetId: number, childIndex: number): boolean {
        const current = this.getCurrent();
        if (current instanceof OptionDialogue) {
            if (widgetId !== OptionDialogue.OPTIONS_WIDGET_ID || !Number.isInteger(childIndex)
                || childIndex < 1 || childIndex > current.getOptions().length) return false;
            this.handleOption(childIndex as DialogueOption);
            return true;
        }
        if (!this.canContinue(widgetId)) return false;
        // An overhead line or a held moment leaves the previous chatbox up; held Space
        // would otherwise end the chain under its timer.
        if (current instanceof ActionDialogue && current.isSelfAdvancing()) return true;
        this.advance();
        return true;
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

    public startDialogues(builder: DialogueBuilder, owner?: object) {
        this.startDialog(builder, 0, owner);
    }

    public startDialog(builder: DialogueBuilder, index: number, owner?: object): void {
        if (builder instanceof DynamicDialogueBuilder) {
            builder.build(this.player);
        }
        this.startDialogueMap(builder.getDialogues(), index, owner);
    }

    private startDialogueMap(entries: Map<number, Dialogue>, index: number, owner?: object) {
        this.reset();
        this.owner = owner;
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
        // Arbitrary action callbacks may open a different feature's prompt.
        // Only visible entries inherit the chain owner; an action that presents
        // owned UI must scope that presentation explicitly.
        const presentationOwner = dialogue instanceof ActionDialogue ? undefined : this.owner;
        if (this.owner === undefined) dialogue.send(this.player);
        else this.player.getPacketSender().withChatboxOwner(presentationOwner, () => dialogue.send(this.player));
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
