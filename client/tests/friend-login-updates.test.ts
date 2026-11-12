import assert from "node:assert/strict";
import type { FriendSnapshot } from "../common/social/FriendsChat";
import { FriendLoginUpdates, friendLoginNoticesShown } from "../game/chat/FriendLoginUpdates";

const friend = (name: string, world: number, previousName = ""): FriendSnapshot =>
    ({ name, world, previousName, rank: 0, isOnline: world > 0 });
const queue = new FriendLoginUpdates();
queue.update([friend("Alice", 1)], 1_000);
assert.deepEqual(queue.drain(20_000), [], "initial online friends do not announce themselves");
queue.update([friend("Alice", 0)], 20_000);
queue.update([friend("Alice", 0)], 21_000);
assert.deepEqual(queue.drain(25_999), [], "native whole-second strict delay");
assert.deepEqual(queue.drain(26_000), ["Alice has logged out."], "one notice despite repeated snapshots");
assert.deepEqual(queue.drain(30_000), [], "only emitted once");
queue.update([friend("Alice", 1)], 30_000);
assert.deepEqual(queue.drain(36_000), ["Alice has logged in."]);
queue.update([friend("Alice", 0)], 40_000);
queue.update([friend("Alice", 1)], 42_000);
assert.deepEqual(queue.drain(60_000), [], "rapid reconnect cancels both transitions");
queue.update([friend("Alice", 0)], 60_000);
queue.update([friend("Alice", 1)], 61_000);
queue.update([friend("Alice", 0)], 62_000);
assert.deepEqual(queue.drain(68_000), ["Alice has logged out."], "a third transition starts a new delay");
queue.update([friend("Alice", 1), friend("Bob", 1)], 70_000);
queue.update([friend("ALICE", 1), friend("Bob", 1)], 71_000);
assert.deepEqual(queue.drain(76_000), ["Alice has logged in."], "new additions and case changes are silent");
queue.update([friend("ALICE", 0), friend("Bob", 1)], 80_000);
queue.update([friend("Renamed", 0, "ALICE"), friend("Bob", 1)], 81_000);
assert.deepEqual(queue.drain(86_000), ["Renamed has logged out."], "pending notice follows an existing friend's rename");
queue.update([friend("Renamed", 1, "ALICE"), friend("Bob", 1)], 90_000);
queue.update([friend("Bob", 1)], 91_000);
assert.deepEqual(queue.drain(100_000), [], "removed friends cannot leave stale queued notices");
queue.update([friend("Bob", 0)], 110_000);
queue.clear();
queue.update([friend("Bob", 1)], 111_000);
assert.deepEqual(queue.drain(130_000), [], "a fresh session suppresses its initial bulk list");
console.log("Friend login updates tests passed");

// Row 44: Off hides the notices; Timeout and On show them.
const vars = (values: Record<number, number>) => (id: number) => values[id] ?? 0;
assert.equal(friendLoginNoticesShown(vars({})), true, "Timeout shows notices");
assert.equal(friendLoginNoticesShown(vars({ 12274: 1, 1627: 1 })), true, "On shows notices");
assert.equal(friendLoginNoticesShown(vars({ 12274: 2, 1627: 0 })), false, "Off hides notices");
