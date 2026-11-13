import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createNpcEcs } from "../game/ecs/createNpcEcs";
import { NpcType } from "../rs/config/npctype/NpcType";
import { applyGlobalNpcHeadIcons, applyNpcSpecificHeadIcon, type NpcHeadIcons } from "../game/sync/NpcHeadIcons";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { handleInboundSync } from "../network/serverConnection/handlers/inboundSync";
import { subscribeNpcSpecificEffects } from "../network/serverConnection/subscriptions/sync";

function fixture() {
    const icons: NpcHeadIcons = new Map();
    const ecs = createNpcEcs(() => undefined, index => icons.delete(index));
    const type = new NpcType(1, { game: "oldschool", revision: 241 } as any);
    type.headIconSpriteIds = [440, 440];
    type.headIconSpriteIndices = [0, 2];
    const spawn = () => {
        const id = ecs.createNpc(50, 50, 1, 1, 64, 64, 0, 0, 0, 0);
        ecs.setServerMapping(id, 7);
        return id;
    };
    const apply = (slot: number, archiveId: number, spriteId: number, index = 7) =>
        applyNpcSpecificHeadIcon(ecs, icons, () => type, { index, slot, archiveId, spriteId });
    return { icons, ecs, type, spawn, apply };
}

test("specific headicons preserve cache slots, clear only one slot and remain viewer local", () => {
    const a = fixture(), b = fixture();
    a.spawn(); b.spawn();
    a.apply(0, 6405, 5);
    assert.deepEqual(a.icons.get(7)?.slice(0, 2), [{ archiveId: 6405, spriteId: 5 }, { archiveId: 440, spriteId: 2 }]);
    assert.equal(a.icons.get(7)?.length, 8);
    assert.equal(b.icons.has(7), false);
    a.apply(0, -1, -1);
    assert.deepEqual(a.icons.get(7)?.[0], { archiveId: -1, spriteId: -1 });
    assert.equal(a.icons.get(7)?.[1].spriteId, 2);
    assert.equal(a.type.headIconSpriteIndices?.[0], 0, "cache definitions are not mutated");
    a.apply(7, 65534, 32767);
    assert.deepEqual(a.icons.get(7)?.[7], { archiveId: 65534, spriteId: 32767 });
    a.apply(8, 6405, 1);
    assert.equal(a.icons.get(7)?.length, 8, "invalid slots cannot extend the native eight slots");
});

test("global replacement overrides specifics and an empty global update restores cache defaults", () => {
    const f = fixture(); f.spawn();
    f.apply(2, 6405, 4);
    applyGlobalNpcHeadIcons(f.icons, 7, [{ archiveId: 440, spriteId: 1 }]);
    assert.deepEqual(f.icons.get(7), [{ archiveId: 440, spriteId: 1 }]);
    f.apply(2, 6405, 3);
    assert.deepEqual(f.icons.get(7)?.slice(0, 3), [{ archiveId: 440, spriteId: 1 }, { archiveId: -1, spriteId: -1 }, { archiveId: 6405, spriteId: 3 }]);
    applyGlobalNpcHeadIcons(f.icons, 7, []);
    f.apply(7, 6405, 2);
    assert.deepEqual(f.icons.get(7)?.[0], { archiveId: 440, spriteId: 0 });
});

test("unknown, removed, map-removed and reused NPC indices cannot retain specific icons", () => {
    const f = fixture();
    f.apply(0, 6405, 1);
    assert.equal(f.icons.size, 0);
    const id = f.spawn();
    f.apply(0, 6405, 2);
    f.ecs.destroyNpc(id);
    assert.equal(f.icons.size, 0);
    f.apply(0, 6405, 3);
    const replacement = f.spawn();
    assert.equal(f.icons.size, 0);
    f.apply(0, 6405, 4);
    f.ecs.setServerMapping(replacement, 8);
    assert.equal(f.icons.size, 0);
    f.spawn(); f.apply(0, 6405, 5);
    f.ecs.destroyNpcsForMap(50, 50);
    assert.equal(f.icons.size, 0);
    f.spawn(); f.apply(0, 6405, 6);
    f.ecs.reset();
    f.spawn();
    assert.equal(f.icons.size, 0, "logout/reset cannot leak icons into a new connection");
});

test("opcode26 reaches the actual subscription and normalizes unsigned clear sentinels", () => {
    const f = fixture(); f.spawn();
    const unsubscribe = subscribeNpcSpecificEffects(effect => {
        if (effect.kind === "headicon") applyNpcSpecificHeadIcon(f.ecs, f.icons, () => f.type, effect);
    });
    try {
        const packet = decodeServerPacket(Uint8Array.from([26, 0, 7, 7, 25, 5, 0, 0]));
        assert.ok(packet);
        assert.equal(handleInboundSync(packet), true);
        assert.deepEqual(f.icons.get(7)?.[7], { archiveId: 6405, spriteId: 0 });
        const clear = decodeServerPacket(Uint8Array.from([26, 0, 7, 7, 255, 255, 255, 255]));
        assert.ok(clear); handleInboundSync(clear);
        assert.deepEqual(f.icons.get(7)?.[7], { archiveId: -1, spriteId: -1 });
        assert.equal(decodeServerPacket(Uint8Array.from([26, 0, 7, 0])), null);
    } finally { unsubscribe(); }
});

test("real OsrsClient NPC_INFO type-change continuation retains icons while plain removal ends them", async () => {
    (globalThis as any).self = globalThis;
    const extensions = [".glsl", ".wgsl", ".vert", ".frag", ".jpg", ".png", ".jpeg", ".svg", ".gif", ".webp"];
    const previous = new Map(extensions.map(extension => [extension, require.extensions[extension]]));
    try {
        for (const extension of extensions) {
            require.extensions[extension] = (module: any, file: string) => {
                module.exports = [".glsl", ".wgsl", ".vert", ".frag"].includes(extension) ? readFileSync(file, "utf8") : file;
            };
        }
        const { OsrsClient } = await import("../game/OsrsClient");
        const host: any = Object.create(OsrsClient.prototype);
        host.npcHeadIcons = new Map();
        host.npcModelOverrides = new Map();
        host.npcInstances = { instanceMap: new Map() };
        host.npcEcs = createNpcEcs(() => undefined, index => host.npcHeadIcons.delete(index));
        const spawn = (type: number) => {
            const id = host.npcEcs.createNpc(50, 50, type, 1, 64, 64, 0, 0, 0, 0);
            host.npcEcs.setServerMapping(id, 7);
        };
        spawn(1);
        applyNpcSpecificHeadIcon(host.npcEcs, host.npcHeadIcons, () => undefined,
            { index: 7, slot: 0, archiveId: 6405, spriteId: 4 });
        const readd = { npcId: 7, typeId: 2, tileX: 3200, tileY: 3200, level: 0, rot: 0, teleport: false, worldViewId: -1 };
        host.npcEcs.removeForNpcInfo({ removals: [7], spawns: [readd] }, (index: number) => host.despawnNpcBinary(index));
        spawn(2);
        assert.equal(host.npcHeadIcons.get(7)?.[0]?.spriteId, 4, "same live NPC keeps its customized icon");
        host.npcEcs.removeForNpcInfo({ removals: [7], spawns: [] }, (index: number) => host.despawnNpcBinary(index));
        assert.equal(host.npcHeadIcons.has(7), false, "plain NPC_INFO removal clears the same customization");
        spawn(1);
        assert.equal(host.npcHeadIcons.has(7), false, "a later index reuse is a fresh NPC");

        // A transformed NPC starts from the type the head-icon renderer draws, not its base type.
        const base = new NpcType(3, { game: "oldschool", revision: 241 } as any);
        base.headIconSpriteIds = [440]; base.headIconSpriteIndices = [0];
        base.transforms = [4];
        const shown = new NpcType(4, { game: "oldschool", revision: 241 } as any);
        shown.headIconSpriteIds = [440, 440]; shown.headIconSpriteIndices = [5, 6];
        base.transform = () => shown;
        host.npcTypeLoader = { load: (id: number) => (id === 3 ? base : id === 4 ? shown : undefined) };
        host.varManager = {};
        assert.equal(host.headIconNpcType(3), shown);
        host.npcEcs.reset();
        spawn(3);
        applyNpcSpecificHeadIcon(host.npcEcs, host.npcHeadIcons, (typeId: number) => host.headIconNpcType(typeId),
            { index: 7, slot: 0, archiveId: 6405, spriteId: 4 });
        assert.deepEqual(host.npcHeadIcons.get(7)?.slice(0, 2), [{ archiveId: 6405, spriteId: 4 }, { archiveId: 440, spriteId: 6 }]);
    } finally {
        for (const [extension, handler] of previous) {
            if (handler) require.extensions[extension] = handler;
            else delete require.extensions[extension];
        }
    }
});
