import type { OrderedClientEvent } from "./QuestHelperProtocol";
/** Source callbacks append synchronously, preserving delivery order until the next atomic snapshot. */
export class QuestHelperEvents {
    private events: OrderedClientEvent[] = [];
    constructor(private readonly capacity = 2048) { }
    push(event: OrderedClientEvent): void { if (this.events.length >= this.capacity)
        throw new Error("Quest Helper event queue overflow; reselect the quest to resynchronize."); this.events.push(event); }
    drain(): OrderedClientEvent[] { const events = this.events; this.events = []; return events; }
    clear(): void { this.events = []; }
}
