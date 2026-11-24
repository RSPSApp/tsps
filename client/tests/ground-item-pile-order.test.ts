import assert from "node:assert/strict";
import { test } from "node:test";

import { GroundItemStore } from "../game/data/ground/GroundItemStore";

// OSRS keeps a tile's pile with the most valuable item at the front and the rest in arrival
// order; the menu lists it top to bottom, so a left click takes the most valuable item.

const ITEMS: Record<number, { name: string; cost: number; stackable?: boolean }> = {
    526: { name: "Bones", cost: 1 },
    1333: { name: "Rune scimitar", cost: 25600 },
    995: { name: "Coins", cost: 1, stackable: true },
    1511: { name: "Logs", cost: 4 },
};

function store(): GroundItemStore {
    const s = new GroundItemStore();
    s.setMetadataResolver((id) => ({ ...ITEMS[id], gePrice: 0, haPrice: 0, tradeable: true }));
    return s;
}
const stack = (id: number, itemId: number, quantity = 1) => ({ id, itemId, quantity, tile: { x: 10, y: 20, level: 0 } });
const names = (s: GroundItemStore) => s.getPileAt(10, 20, 0).map((entry) => entry.name);

test("the most valuable item is on top, whatever was dropped last", () => {
    const s = store();
    s.update({ kind: "delta", upserts: [stack(1, 1333)] } as any);
    s.update({ kind: "delta", upserts: [stack(2, 526)] } as any);
    s.update({ kind: "delta", upserts: [stack(3, 1511)] } as any);
    assert.deepEqual(names(s), ["Rune scimitar", "Bones", "Logs"]);
});

test("a stackable item is valued by its quantity plus one", () => {
    const s = store();
    s.update({ kind: "delta", upserts: [stack(1, 1511)] } as any);
    s.update({ kind: "delta", upserts: [stack(2, 995, 3)] } as any);
    assert.deepEqual(names(s), ["Logs", "Coins"]);
    s.update({ kind: "delta", upserts: [stack(2, 995, 4)] } as any);
    assert.deepEqual(names(s), ["Coins", "Logs"]);
});

test("taking the top item promotes the next most valuable; an earlier top keeps its place", () => {
    const s = store();
    s.update({ kind: "delta", upserts: [stack(1, 526)] } as any);
    s.update({ kind: "delta", upserts: [stack(2, 1511)] } as any);
    s.update({ kind: "delta", upserts: [stack(3, 1333)] } as any);
    assert.deepEqual(names(s), ["Rune scimitar", "Logs", "Bones"]);
    s.update({ kind: "delta", removes: [3] } as any);
    assert.deepEqual(names(s), ["Logs", "Bones"]);
});
