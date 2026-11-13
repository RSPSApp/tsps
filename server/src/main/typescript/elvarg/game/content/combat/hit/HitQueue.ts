import { CombatFactory } from "../CombatFactory";
import { PluginManager } from "../../../../plugins/PluginManager";
import type { Mobile } from "../../../entity/impl/Mobile";
import { World } from "../../../World";
import { HitDamage } from "./HitDamage";
import { HitMask } from "./HitMask";
import { PendingHit } from "./PendingHit";

type ScheduledHit = { hit: PendingHit; revealCycle: number };

/** Schedules combat impacts against an absolute world tick. */
export class HitQueue {
    private static readonly active = new Set<HitQueue>();
    private readonly pendingHits: ScheduledHit[] = [];
    private readonly pendingDamage: HitDamage[] = [];
    private lastProcessedCycle = -1;
    private lastAppliedHit: HitDamage | null = null;
    private poisonSplats = 0;
    private incomingGeneration = 0;

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

        // NPC attacks queued before this turn read the protection prayer now, after this tick's
        // clicks (CombatFactory.addPendingHit), whenever they land; held or not.
        for (const { hit } of this.pendingHits) CombatFactory.applyProtectionPrayer(hit);

        // Wiki: Animation stall. A full stall queues hits up on the player and delivers them only
        // once the action completes. The hold is read here, at impact, rather than when the hit was
        // queued: a shot already in the air when the swing starts must still wait for it, and
        // content that stops the animation early has to release the hits it was holding on that
        // tick rather than on the deadline the stall once had. Only players stall, so an NPC's hits
        // keep landing on the dot - and an NPC's Combat has nothing to ask.
        const hold = this.character.isPlayer()
            ? this.character.getCombat().getIncomingHitCycle()
            : -1;
        const stalled = hold > currentCycle;
        while (
            !stalled &&
            this.pendingHits.length > 0 &&
            this.pendingHits[0].revealCycle <= currentCycle
        ) {
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
        //
        // A multi-hit special's later splats never reach pendingHits at all: CombatFactory
        // .applyResolvedHitDamage schedules each one past its hit's own delay straight into this
        // list (dragon claws' Slice and Dice lands two, then two more a tick later), so the stall
        // holds them too - Wiki: Animation stall queues the hits coming in to the player.
        //
        // Only what is coming in waits. Damage the owner took on itself - a recoil ring, a bolt's
        // cost, its poison - is not an incoming hit, so it still lands on its own tick wherever it
        // sits in the list; breaking the drain at the first held splat would hand the owner a free
        // tick of self-damage every time a proc queued up behind a delayed special. The held
        // entries are put back as a block, so the chain keeps the order the client shows it in.
        const held: HitDamage[] = [];
        const generation = this.incomingGeneration;
        while (this.pendingDamage.length > 0) {
            const damage = this.pendingDamage.shift()!;
            if (stalled && HitQueue.incomingFromOther(damage, character)) {
                held.push(damage);
                continue;
            }
            character.addTickHit(this.applyDamage(damage));
        }
        // clearIncoming ran while the drain was going (a phoenix necklace fired): the held hits were
        // incoming too, so they go with it.
        if (held.length > 0 && generation === this.incomingGeneration) {
            this.pendingDamage.unshift(...held);
        }
        if (!this.hasPendingWork()) HitQueue.active.delete(this);
    }

    /** Damage another combatant landed on the owner, not damage the owner took on itself. */
    private static incomingFromOther(damage: HitDamage, owner: Mobile): boolean {
        const source = damage.getSource();
        return source != null && source !== owner;
    }

    /** Whether the owner's queue has already been drained this cycle (its turn has passed). */
    hasProcessed(cycle: number): boolean {
        return this.lastProcessedCycle === cycle;
    }

    /** Takes a hit off the owner's hitpoints, then runs effects that react to the result. */
    private applyDamage(hit: HitDamage): HitDamage {
        const applied = this.character.decrementHealth(hit);
        if (applied.getDamage() > 0 || this.character.getHitpoints() > 0) this.lastAppliedHit = applied;
        if (applied.getHitmask() === HitMask.GREEN && applied.getDamage() > 0) this.poisonSplats++;
        hit.notifyApplied(applied.getHealthLost());
        if (hit.isReflected() && applied.getHealthLost() > 0) {
            // "combat:reflected-damage" { target, source, hit, taken }: a rebound (recoil, Vengeance, Retribution)
            // that cost its target health. Reflections skip the resolved-hit hooks, so this is where they land.
            PluginManager.emitCustomEvent("combat:reflected-damage",
                { target: this.character, source: hit.getSource(), hit: applied, taken: applied.getHealthLost() });
        }
        CombatFactory.handleRedemption(this.character);
        return applied;
    }

    /** How many poison-type (green) splats with damage have landed; it only grows. */
    getPoisonSplatCount(): number {
        return this.poisonSplats;
    }

    /** The last hit taken; after a death it is the killing blow. */
    getLastAppliedHit(): HitDamage | null {
        return this.lastAppliedHit;
    }

    /** Queues a hit for the cycle it comes due on; process() is what decides whether it waits. */
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

    /**
     * Drops what is still on its way in from other combatants - delayed hits, the rest of a
     * multi-hit special - and keeps the owner's own pending damage (poison, recoil).
     */
    clearIncoming(): void {
        this.incomingGeneration++;
        this.pendingHits.length = 0;
        for (let i = this.pendingDamage.length - 1; i >= 0; i--) {
            if (HitQueue.incomingFromOther(this.pendingDamage[i], this.character)) this.pendingDamage.splice(i, 1);
        }
        if (!this.hasPendingWork()) HitQueue.active.delete(this);
    }

    /** Changes every time clearIncoming runs; deferred hits compare it to know they were cancelled. */
    getIncomingGeneration(): number {
        return this.incomingGeneration;
    }

    /**
     * Drops the hits `attacker` still has on their way to anyone. Called when it dies: process()
     * already drops them while it is dead, so this keeps a hit launched before the death from
     * landing - and crediting - after a respawn of the same object.
     */
    static dropHitsFrom(attacker: Mobile): void {
        for (const queue of [...this.active]) {
            const hits = queue.pendingHits;
            for (let i = hits.length - 1; i >= 0; i--) {
                if (hits[i].hit.getAttacker() === attacker) hits.splice(i, 1);
            }
            if (!queue.hasPendingWork()) this.active.delete(queue);
        }
    }

    hasPendingWork(): boolean {
        return this.pendingHits.length > 0 || this.pendingDamage.length > 0;
    }

    /** Whether another player's hit is on its way to the owner: queued, not landed yet. */
    hasIncomingPlayerHit(): boolean {
        return this.pendingHits.some(({ hit }) => hit.getAttacker()?.isPlayer?.() === true && hit.getAttacker() !== this.character);
    }

    /** Whether this exact hit is still queued, independent of other hits from its attacker. */
    hasPendingHit(hit: PendingHit): boolean {
        return this.pendingHits.some((entry) => entry.hit === hit);
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

    /** Like isEmpty, but hits on their way from NPCs nobody owns don't count either. */
    isEmptyButFreeNpcs(exception: Mobile): boolean {
        return this.pendingHits.every(({ hit }) => {
            const attacker = hit.getAttacker();
            return attacker === exception || (attacker.isNpc() && attacker.getAsNpc().getOwner() == null);
        });
    }
}
