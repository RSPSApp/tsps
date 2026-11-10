import "./browser-self";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { GroundItemStore } from "../game/data/ground/GroundItemStore";
import type { GroundItemsServerPayload } from "../network/serverConnection/types/messages";
import { LOGS } from "../runelite/api/gameval/ItemID";
import { FIRE } from "../runelite/api/gameval/ObjectID";

const tile = { x: 3200, y: 3200, level: 0 };
const log = { id: 5, itemId: LOGS, quantity: 1, tile };
const snapshot: GroundItemsServerPayload = { kind: "snapshot", serial: 1, stacks: [log] };
const remove: GroundItemsServerPayload = { kind: "delta", serial: 2, upserts: [], removes: [log.id] };

require.extensions[".glsl"] = (module, file) => { module.exports = readFileSync(file, "utf8"); };
for (const extension of [".png", ".jpg", ".webp"]) {
    require.extensions[extension] = (module, file) => { module.exports = file; };
}

async function setup() {
    const { OsrsClient } = await import("../game/OsrsClient");
    const meshes: number[][] = [];
    const built = new Map<number, { id: number; shape: number; rotation: number }[]>();
    const client = Object.assign(Object.create(OsrsClient.prototype), {
        groundItems: new GroundItemStore(),
        burningLogMeshes: new Map(),
        locOpFlags: new Map(),
        objTypeLoader: { load: () => ({ groundActions: ["Light"] }) },
        sceneGeometry: { locsAtTile: (_x: number, _y: number, level: number) => built.get(level) ?? [] },
        renderer: {
            updateGroundItemMeshes: (stacks: { id: number }[]) => meshes.push(stacks.map((stack) => stack.id)),
            onLocAddChange() {},
            onLocDel() {},
        },
    }) as InstanceType<typeof OsrsClient>;
    const apply = (payload: GroundItemsServerPayload) =>
        (client as unknown as { applyGroundItemUpdate(payload: GroundItemsServerPayload): void }).applyGroundItemUpdate(payload);
    apply(snapshot);
    return { client, apply, meshes, built };
}

test("a same-batch fire keeps only the log mesh until the matching fire is built", async () => {
    const { client, apply, meshes, built } = await setup();
    apply(remove);
    client.onLocAddChange(FIRE, tile, 0, 10, 0);
    assert.equal(client.groundItems.getStackById(log.id), undefined);
    await Promise.resolve();
    assert.deepEqual(meshes.at(-1), [log.id]);

    built.set(1, [{ id: FIRE, shape: 10, rotation: 0 }]);
    built.set(0, [{ id: FIRE, shape: 10, rotation: 1 }]);
    client.updateGroundItemMeshHandoffs();
    assert.deepEqual(client.getGroundItemMeshStacks().map((stack) => stack.id), [log.id]);

    built.set(0, [{ id: FIRE, shape: 10, rotation: 0 }]);
    client.updateGroundItemMeshHandoffs();
    assert.deepEqual(meshes.at(-1), []);
});

test("an unpaired or cancelled fire never leaves a stale log mesh", async () => {
    const { client, apply, meshes } = await setup();
    apply(remove);
    await Promise.resolve();
    client.onLocAddChange(FIRE, tile, 0, 10, 0);
    assert.deepEqual(meshes.at(-1), []);
    assert.deepEqual(client.getGroundItemMeshStacks(), []);

    apply({ ...snapshot, serial: 3 });
    apply({ ...remove, serial: 4 });
    client.onLocAddChange(FIRE, tile, 0, 10, 0);
    await Promise.resolve();
    assert.deepEqual(meshes.at(-1), [log.id]);
    client.onLocDel(tile, 0, 10, 0);
    client.updateGroundItemMeshHandoffs();
    assert.deepEqual(meshes.at(-1), []);
});

test("a full ground item snapshot clears an active log mesh handoff", async () => {
    const { client, apply, meshes } = await setup();
    apply(remove);
    client.onLocAddChange(FIRE, tile, 0, 10, 0);
    await Promise.resolve();
    assert.deepEqual(meshes.at(-1), [log.id]);

    const replacement = { ...log, id: log.id + 1 };
    apply({ kind: "snapshot", serial: 3, stacks: [replacement] });
    assert.deepEqual(meshes.at(-1), [replacement.id]);
    assert.deepEqual(client.getGroundItemMeshStacks().map((stack) => stack.id), [replacement.id]);
});
