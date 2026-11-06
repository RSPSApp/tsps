import type { NPC } from "../game/entity/impl/npc/NPC";

/** One session's transient effects. An index alone cannot identify an NPC across removal. */
export class NpcSpecificEffects {
  private pending: { npc: NPC; index: number; packet: Buffer }[] = [];
  queue(npc: NPC, packet: Buffer): void {
    this.pending.push({ npc, index: npc.getIndex(), packet });
  }
  take(): { npc: NPC; index: number; packet: Buffer }[] {
    const pending = this.pending;
    this.pending = [];
    return pending;
  }
  clear(): void { this.pending = []; }
}
