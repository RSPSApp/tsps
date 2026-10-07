import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { IndexType } from "../rs/cache/IndexType";
import { Opcodes } from "../rs/cs2/Opcodes";
import { parseScriptFromBytes } from "../rs/cs2/Script";
import { createHandlerMap } from "../rs/cs2/handlers";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

/**
 * Every instruction the cache's own scripts use has a handler (or a case in the VM's core switch).
 * A missing one stops the script there with "Unknown opcode"; after a cache revision update this
 * lists them up front. Names and signatures: zwyz/osrs-cache data/commands.
 */
test("every instruction in the cache's clientscripts has a handler", () => {
    const info = loadCacheList(loadCacheInfos()).latest;
    const index = CacheSystem.fromFiles(info, loadCache(info).files).getIndex(IndexType.DAT2.clientScript);
    const vmSource = fs.readFileSync(path.join(__dirname, "../rs/cs2/Cs2Vm.ts"), "utf8");
    const coreCases = new Set([...vmSource.matchAll(/case Opcodes\.([A-Z0-9_]+):/g)].map((m) => (Opcodes as any)[m[1]]));
    const handlers = createHandlerMap();
    const missing = new Map<number, number[]>();
    for (const id of index.getArchiveIds()) {
        const script = parseScriptFromBytes(id, index.getFile(id, 0)!.data);
        for (const opcode of script.instructions) {
            if (handlers.has(opcode) || coreCases.has(opcode)) continue;
            if (!missing.has(opcode)) missing.set(opcode, []);
            missing.get(opcode)!.push(id);
        }
    }
    assert.deepEqual(
        [...missing].map(([opcode, scripts]) => `${opcode} (script ${scripts[0]}${scripts.length > 1 ? ` +${scripts.length - 1}` : ""})`),
        [],
        `cache ${info.name}`,
    );
});
