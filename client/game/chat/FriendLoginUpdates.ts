import type { FriendSnapshot } from "../../common/social/FriendsChat";

interface LoginUpdate {
    name: string;
    world: number;
    time: number;
}

/** Native FriendContainer.read / FriendSystem.processFriendUpdates, fed by full snapshots. */
export class FriendLoginUpdates {
    private friends = new Map<string, FriendSnapshot>();
    private pending: LoginUpdate[] = [];

    update(friends: readonly FriendSnapshot[], now = Date.now()): void {
        const next = new Map(friends.map((friend) => [friend.name.toLowerCase(), friend]));
        for (const friend of friends) {
            const key = friend.name.toLowerCase();
            const previous = this.friends.get(key) ?? this.friends.get(friend.previousName.toLowerCase());
            if (!previous) continue; // The initial list and newly added friends are not login events.
            if (previous.name.toLowerCase() !== key) {
                for (const update of this.pending) {
                    if (update.name.toLowerCase() === previous.name.toLowerCase()) update.name = friend.name;
                }
            }
            if (previous.world === friend.world) continue;
            let cancelled = false;
            this.pending = this.pending.filter((update) => {
                if (update.name.toLowerCase() === key && (update.world === 0) !== (friend.world === 0)) {
                    cancelled = true;
                    return false;
                }
                return true;
            });
            if (!cancelled) this.pending.push({ name: friend.name, world: friend.world, time: Math.floor(now / 1000) });
        }
        this.pending = this.pending.filter((update) => next.has(update.name.toLowerCase()));
        this.friends = next;
    }

    drain(now = Date.now()): string[] {
        const messages: string[] = [];
        // The native queue uses whole seconds and a strict older-than-five-seconds comparison.
        this.pending = this.pending.filter((update) => {
            if (update.time >= Math.floor(now / 1000) - 5) return true;
            messages.push(`${update.name} has logged ${update.world > 0 ? "in" : "out"}.`);
            return false;
        });
        return messages;
    }

    clear(): void {
        this.friends.clear();
        this.pending = [];
    }
}
