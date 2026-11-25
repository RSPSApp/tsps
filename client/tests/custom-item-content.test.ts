import assert from "node:assert/strict";
import { test } from "node:test";

import { clearWorldOverlays } from "../common/gamemode/GamemodeContentStore";
import { CustomItemRegistry } from "../custom/items/CustomItemRegistry";
import { handleInboundUi } from "../network/serverConnection/handlers/inboundUi";

test("item batches install atomically in the client and in workers", async (t) => {
    const delivered: unknown[] = [];
    let cacheClears = 0;
    const client = {
        objTypeLoader: { clearCache: () => cacheClears++ },
        workerPool: {
            runAll: async (fn: (worker: { setCustomContent: (payload: unknown) => void }) => void) => {
                fn({ setCustomContent: payload => delivered.push(payload) });
            },
        },
    };
    const globals = globalThis as typeof globalThis & { __osrsClient?: typeof client };
    globals.__osrsClient = client;
    t.after(() => {
        delete globals.__osrsClient;
        clearWorldOverlays();
        CustomItemRegistry.clear();
    });

    const first = { id: 59500, objType: { name: "First" } };
    const second = { id: 59501, objType: { name: "Second" } };
    const gamemodeId = "server";
    const batch = (rows: unknown[]) => handleInboundUi({
        type: "gamemode_data", payload: { gamemodeId, datasets: [{ key: "customItemsBatch", rows }] },
    });

    assert.equal(batch([2]), true);
    batch([first]);
    assert.equal(CustomItemRegistry.getCount(), 0);
    assert.equal(cacheClears, 0);
    assert.deepEqual(delivered, []);

    clearWorldOverlays();
    batch([second]);
    assert.equal(CustomItemRegistry.getCount(), 0);
    batch([2]);
    batch([first]);
    batch([second]);
    assert.deepEqual([...CustomItemRegistry.getAllIds()], [first.id, second.id]);
    assert.equal(cacheClears, 1);
    assert.deepEqual(delivered, [{ gamemodeId, datasets: [{ key: "customItems", rows: [first, second] }] }]);
});
