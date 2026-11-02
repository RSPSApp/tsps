/**
 * Server-set widget properties (text, hidden, model, ...) for a cache interface that is not
 * loaded yet, held until the client loads it.
 *
 * Servers set an interface's contents before opening it (a journal scroll's lines, then the
 * open), so dropping them leaves the first open empty. Loading the interface on the spot would
 * do the job too, but servers also address components that never open - legacy ids that land in
 * interface 0, overlays for areas the player is not in - and loading those has side effects. So
 * the latest value per component and property waits, and is applied when the interface loads.
 */
export class HeldWidgetProperties {
    private readonly byGroup = new Map<number, Map<string, { uid: number; serverOwned?: boolean }>>();

    get size(): number {
        return this.byGroup.size;
    }

    /** Holds a payload, replacing an earlier one for the same component and property. */
    hold(payload: { action: string; uid: number; serverOwned?: boolean }): void {
        const groupId = (payload.uid >>> 16) & 0xffff;
        let held = this.byGroup.get(groupId);
        if (!held) {
            held = new Map();
            this.byGroup.set(groupId, held);
        }
        const key = `${payload.action}:${payload.uid | 0}`;
        const previous = held.get(key);
        if (payload.serverOwned === undefined && previous?.serverOwned !== undefined) {
            payload = { ...payload, serverOwned: previous.serverOwned };
        }
        // Re-inserting keeps arrival order for the latest value.
        held.delete(key);
        held.set(key, payload);
    }

    /** Everything held for a group, in arrival order; the group is no longer held. */
    take(groupId: number): unknown[] {
        const held = this.byGroup.get(groupId | 0);
        this.byGroup.delete(groupId | 0);
        return held ? [...held.values()] : [];
    }

    /** Forgets everything (a new session). */
    clear(): void {
        this.byGroup.clear();
    }
}
