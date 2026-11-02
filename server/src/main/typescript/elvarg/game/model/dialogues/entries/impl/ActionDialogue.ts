import { Action } from "../../../Action";
import { Dialogue } from "../Dialogue";
import { Player } from "../../../../entity/impl/player/Player";
export class ActionDialogue extends Dialogue {
    private action: Action;
    private readonly selfAdvancing: boolean;

    /**
     * `selfAdvancing`: the action moves the chain on itself (a timer), so a Continue on
     * whatever chatbox is still showing must not advance past it.
     */
    constructor(index: number, action: Action, selfAdvancing = false) {
        super(index);
        this.action = action;
        this.selfAdvancing = selfAdvancing;
    }

    public send(player: Player) {
        this.action.execute();
    }

    public isSelfAdvancing(): boolean {
        return this.selfAdvancing;
    }
}