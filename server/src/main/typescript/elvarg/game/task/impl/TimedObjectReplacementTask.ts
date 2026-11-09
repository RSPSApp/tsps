import { GameObject } from "../../entity/impl/object/GameObject";
import { ObjectManager } from "../../entity/impl/object/ObjectManager";
import { Task } from "../Task";

export class TimedObjectReplacementTask extends Task {
    private original: GameObject;
    private temp: GameObject;
    private ticks: number;
    private progressTick = 0;
    private sameTile = false;

    /**
     * `ticks` after the swap, the original comes back. Not `immediate`, the swap happens on the
     * tick after the task is submitted; `immediate`, on submission itself.
     */
    constructor(original: GameObject, temp: GameObject, ticks: number, immediate = false) {
        super(1, immediate);
        this.original = original;
        this.temp = temp;
        this.ticks = ticks;
        this.sameTile = original.getLocation().equals(temp.getLocation());
    }

    execute() {
        if (this.progressTick === 0) {
            ObjectManager.deregister(this.original, !this.sameTile);
            ObjectManager.register(this.temp, true);
        } else if (this.progressTick >= this.ticks) {
            ObjectManager.deregister(this.temp, !this.sameTile);
            ObjectManager.register(this.original, true);
            this.stop();
        }
        this.progressTick++;
    }
    onExecute() {

    }
}
