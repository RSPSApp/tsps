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
            this.swap(this.original, this.temp);
        } else if (this.progressTick >= this.ticks) {
            this.swap(this.temp, this.original);
            this.stop();
        }
        this.progressTick++;
    }
    private swap(outgoing: GameObject, incoming: GameObject): void {
        if (this.sameTile) {
            ObjectManager.replaceInPlace(outgoing, incoming);
        } else {
            ObjectManager.deregister(outgoing, true);
            ObjectManager.register(incoming, true);
        }
    }

    onExecute() {

    }
}
