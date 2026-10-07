import { CombatFactory } from "../CombatFactory";
import type { Mobile } from "../../../entity/impl/Mobile";
import { World } from "../../../World";
import { HitDamage } from "./HitDamage";
import { PendingHit } from "./PendingHit";

type ScheduledHit = { hit: PendingHit; revealCycle: number };

/** Schedules combat impacts against an absolute world tick. */
export class HitQueue {
    private static readonly active = new Set<HitQueue>();
    private readonly pendingHits: ScheduledHit[] = [];
    private readonly pendingDamage: HitDamage[] = [];
    private lastProcessedCycle = -1;
    private lastAppliedHit: HitDamage | null = null;

    constructor(private readonly character: Mobile) {}

    /**
     * Catch-all for entities that did not take a turn this cycle - inactive NPCs and
     * bots skipped by the process stride. Anything that did take a turn has already
     * drained at the top of it and is filtered out by the cycle guard.
     */
    static processAll(currentCycle: number): void {
        for (const queue of this.active) queue.process(currentCycle);
    }

    /**
     * Applies every impact due on or before `currentCycle`. Called at the start of the
     * owner's own turn, so a lethal hit lands before that entity gets to act - this is
     * how LostCity orders it (processQueues runs ahead of processInteraction) and it is
     * what stops a mob that is already dead from getting one last swing in.
     */
    process(currentCycle: number): void {
        if (this.lastProcessedCycle === currentCycle) {
            return;
        }
        this.lastProcessedCycle = currentCycle;
        const character = this.character;
        if (!character.isRegistered() || character.getHitpoints() <= 0) {
            this.pendingHits.length = 0;
            this.pendingDamage.length = 0;
            HitQueue.active.delete(this);
            return;
        }

        while (this.pendingHits.length > 0 && this.pendingHits[0].revealCycle <= currentCycle) {
            const { hit } = this.pendingHits.shift()!;
            if (
                hit.getTarget() === character &&
                hit.getAttacker()?.isRegistered() &&
                hit.getAttacker()?.getHitpoints() > 0 &&
                !character.isUntargetable()
            ) {
                CombatFactory.executeHit(hit);
            }
        }

        // Every hit due this tick lands this tick. Once the owner is dead the rest
        // still show, as 0s - decrementHealth never takes hitpoints below zero.
        while (this.pendingDamage.length > 0) {
            character.addTickHit(this.applyDamage(this.pendingDamage.shift()!));
        }
        if (!this.hasPendingWork()) HitQueue.active.delete(this);
    }

    /** Takes a hit off the owner's hitpoints, then runs effects that react to the result. */
    private applyDamage(hit: HitDamage): HitDamage {
        const applied = this.character.decrementHealth(hit);
        if (applied.getDamage() > 0 || this.character.getHitpoints() > 0) this.lastAppliedHit = applied;
        CombatFactory.handleRedemption(this.character);
        return applied;
    }

    /** The last hit taken; after a death it is the killing blow. */
    getLastAppliedHit(): HitDamage | null {
        return this.lastAppliedHit;
    }

    addPendingHit(hit: PendingHit, revealCycle: number): void {
        const scheduled = { hit, revealCycle: Math.max(0, revealCycle | 0) };
        let index = this.pendingHits.length;
        while (index > 0 && this.pendingHits[index - 1].revealCycle > scheduled.revealCycle) index--;
        this.pendingHits.splice(index, 0, scheduled);
        HitQueue.active.add(this);
    }

    addPendingDamage(hits: HitDamage[]): void {
        for (const hit of hits) if (hit != null) this.pendingDamage.push(hit);
        if (hits.length > 0) HitQueue.active.add(this);
    }

    clear(): void {
        this.pendingHits.length = 0;
        this.pendingDamage.length = 0;
        HitQueue.active.delete(this);
    }

    hasPendingWork(): boolean {
        return this.pendingHits.length > 0 || this.pendingDamage.length > 0;
    }

    hasPendingHitFrom(attacker: Mobile): boolean {
        return this.pendingHits.some(({ hit }) => hit.getAttacker() === attacker);
    }

    getQueuedDamage(): number {
        return this.pendingDamage.reduce((total, hit) => total + hit.getDamage(), 0);
    }

    getAccumulatedDamage(): number {
        let damage = 0;
        const imminentCycle = World.getProcessCycle() + 2;
        for (const { hit, revealCycle } of this.pendingHits) {
            if (revealCycle <= imminentCycle) damage += hit.getTotalDamage();
        }
        for (const hit of this.pendingDamage) damage += hit.getDamage();
        return damage;
    }

    isEmpty(exception: Mobile): boolean {
        return this.pendingHits.every(({ hit }) => hit.getAttacker() === exception);
    }
}
