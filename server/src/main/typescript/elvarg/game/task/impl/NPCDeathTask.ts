import { Task } from "../Task";
import { World } from "../../World";
import { NPC } from "../../entity/impl/npc/NPC";
import { Player } from "../../entity/impl/player/Player";
import { Animation } from "../../model/Animation";
import { Priority } from "../../model/Priority";
import { TaskManager } from "../TaskManager";
import { NPCRespawnTask } from '../impl/NPCRespawnTask'
import { PluginManager } from "../../../plugins/PluginManager";
import type { PluginNpcDeathEvent } from "../../../plugins/PluginTypes";
import { Sound } from "../../Sound";
import { Sounds } from "../../Sounds";
import { ArceuusSpells } from "../../content/combat/magic/ArceuusSpells";
import { CombatSpecial } from "../../content/combat/CombatSpecial";


export class NPCDeathTask extends Task {
    private npc: NPC
    private ticks: number;
    private killer: Player | null;
    private remains: { ticks: number; respawnTicks?: number } | null = null;
    
    /**
     * The NPCDeathTask constructor.
     *
     * @param npc The npc being killed.
     */
    constructor(npc: NPC) {
        super(1);
        this.npc = npc;
        this.ticks = 1;
    }

    public execute(): void {
        switch (this.ticks) {
            case 1:
                this.npc.getMovementQueue().setBlockMovement(true).reset();
                this.killer = this.npc.getCombat().getKiller(true);
                this.npc.performAnimation(new Animation(this.npc.getCurrentDefinition().getDeathAnim()));
                const deathSound = this.npc.getCurrentDefinition().getDeathSound();
                if (deathSound > 0) Sounds.sendSound(this.npc, new Sound(deathSound, 1, 0, 0));
                this.npc.getCombat().reset();
                this.npc.getCombat().setUnderAttack(null);
                this.npc.setMobileInteraction(null);
                this.setDelay(Math.max(1, this.npc.getCurrentDefinition().getDeathTicks()));
                break;
            case 0:
                if (this.killer != null) {
                    const event: PluginNpcDeathEvent = {
                        killer: this.killer,
                        npc: this.npc,
                        npcId: this.npc.getId(),
                        location: {
                            x: this.npc.getLocation().getX(),
                            y: this.npc.getLocation().getY(),
                            z: this.npc.getLocation().getZ(),
                        },
                        remains: null,
                    };
                    PluginManager.emitNpcDeath(event);
                    if (event.remains && event.remains.ticks > 0) this.remains = event.remains;
                    if (ArceuusSpells.useDeathCharge(this.killer)) {
                        this.killer.setSpecialPercentage(Math.min(100, this.killer.getSpecialPercentage() + 15));
                        CombatSpecial.updateBar(this.killer);
                    }
                }
                this.stop();
                break;
        }
        this.ticks--;
    }
    
    public stop(): void {
        super.stop();
        if (this.remains) {
            // Left in the world for a while (a plugin's remains); removed and respawned after.
            const remains = this.remains;
            this.remains = null;
            this.npc.setDying(false);
            TaskManager.submit(new NPCRemainsTask(this, remains.ticks, remains.respawnTicks));
            return;
        }
        this.remove();
    }

    /** Takes the npc out of the world and queues its respawn. */
    public remove(respawnTicks?: number): void {
        const skipDefaultRespawn = (this.npc as any).__skipDefaultRespawn === true;
        (this.npc as any).__skipDefaultRespawn = false;

        if (this.npc.getArea() !== null) {
            const area = this.npc.getArea();
            area.leave(this.npc, false);
            if (this.npc.getArea() === area) {
                this.npc.setArea(null);
            }
        }
        this.npc.setDying(false);
        this.npc.setNpcTransformationId(-1);
        const respawn = respawnTicks ?? this.npc.getDefinition().getRespawn();
        if (!skipDefaultRespawn && respawn > 0) {
            TaskManager.submit(new NPCRespawnTask(this.npc, respawn));
        }
        World.getRemoveNPCQueue().push(this.npc);
    }
}

/** An npc's remains: removed (and its respawn queued) once their time is up. */
class NPCRemainsTask extends Task {
    constructor(private readonly death: NPCDeathTask, ticks: number, private readonly respawnTicks?: number) {
        super(Math.max(1, Math.trunc(ticks)));
    }

    public execute(): void {
        this.stop();
        this.death.remove(this.respawnTicks);
    }
}
