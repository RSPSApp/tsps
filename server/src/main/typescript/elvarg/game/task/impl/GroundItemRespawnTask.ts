import { ItemOnGround } from "../../entity/impl/grounditem/ItemOnGround";
import { ItemOnGroundManager } from "../../entity/impl/grounditem/ItemOnGroundManager";
import { Task } from "../Task";

export class GroundItemRespawnTask extends Task {
    /**
    * The {@link ItemOnGround} which is going to respawn.
    */
    private item: ItemOnGround;
    
    constructor(item: ItemOnGround, ticks: number) {
        super(ticks);
        this.item = item;
    }
    
    execute() {
        // Register the new entity..
        const restored = this.item.clone();
        if (restored.isStaticSpawn() && restored.respawns()) {
            restored.getItem().setAmount(restored.getRespawnAmount());
        }
        ItemOnGroundManager.register(restored);
    
        // Stop the task
        this.stop();
    }
}