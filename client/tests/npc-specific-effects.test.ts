import assert from "node:assert/strict";
import { test } from "node:test";
import { NpcEcs } from "../game/ecs/NpcEcs";
import { createNpcEcs } from "../game/ecs/createNpcEcs";
import { SeqType } from "../rs/config/seqtype/SeqType";
import { applyNpcSpecificEffect } from "../game/sync/NpcSpecificEffects";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { handleInboundSync } from "../network/serverConnection/handlers/inboundSync";
import { subscribeNpcSpecificEffects } from "../network/serverConnection/subscriptions/sync";
import { GfxManager } from "../render/gfx/GfxManager";
import { clearNpcSpotAnimations, registerNpcSpotAnimation } from "../render/render/overlays4";

function fixture() {
    const graphics = new GfxManager({} as any);
    const host = { gfxManager: graphics } as any;
    const renderer = {
        registerNpcSpotAnimation: (event: any) => registerNpcSpotAnimation(host, event),
        clearNpcSpotAnimations: (serverId: number) => clearNpcSpotAnimations(host, serverId),
    };
    const ecs = createNpcEcs(() => renderer);
    const unsubscribe = subscribeNpcSpecificEffects(effect => applyNpcSpecificEffect(ecs, renderer, effect, 100));
    const receive = (bytes: number[]) => {
        const decoded = decodeServerPacket(Uint8Array.from(bytes));
        assert.ok(decoded, "fixed packet decoded");
        assert.equal(handleInboundSync(decoded), true, "effect dispatched through network handler");
    };
    const spawn = () => {
        const id = ecs.createNpc(50, 50, 1, 1, 64, 64, 0, 0, 0, 0);
        ecs.setServerMapping(id, 7);
        return id;
    };
    return { ecs, graphics, receive, spawn, unsubscribe };
}

test("specific sequences use real ECS timing and later normal updates can replace them", () => {
    const f = fixture();
    try {
        const id = f.spawn();
        f.receive([24, 0, 7, 1, 44, 255]);
        assert.equal(f.ecs.getSeqId(id), 300);
        assert.equal(f.ecs.getSeqDelay(id), 255);
        assert.equal(f.ecs.hasSeqStartedBy(id, 100), false);
        assert.equal(f.ecs.hasSeqStartedBy(id, 101), true);
        f.ecs.handleServerSequence(id, 301, 0, 101);
        assert.equal(f.ecs.getSeqId(id), 301, "specific event installs no persistent override");
        f.receive([24, 0, 7, 255, 255, 0]);
        assert.equal(f.ecs.getSeqId(id), -1);
        assert.equal(f.ecs.getSeqDelay(id), 0);
    } finally { f.unsubscribe(); }
});

test("specific spots preserve unsigned fields, simultaneous slots and slot-local reset in real graphic manager", () => {
    const f = fixture();
    try {
        f.spawn();
        f.receive([25, 0, 7, 1, 44, 255, 255, 255, 255, 255]);
        f.receive([25, 0, 7, 1, 45, 2, 0, 128, 0, 30]);
        const slots = [...f.graphics.getActorInstances("npc", 7)].sort((a, b) => a.slot! - b.slot!);
        assert.deepEqual(slots.map(s => [s.slot, s.spotId, s.startCycle, s.yOffsetTiles]), [[2, 301, 130, 1], [255, 300, 65635, 65535 / 128]]);
        f.receive([25, 0, 7, 255, 255, 2, 0, 0, 0, 0]);
        assert.deepEqual([...f.graphics.getActorInstances("npc", 7)].map(s => s.slot), [255]);
    } finally { f.unsubscribe(); }
});

test("unknown and removed NPC effects are dropped without replay onto a reused mapping", () => {
    const f = fixture();
    try {
        f.receive([24, 0, 7, 1, 44, 0]);
        f.receive([25, 0, 7, 1, 44, 2, 0, 0, 0, 0]);
        const first = f.spawn();
        assert.equal(f.ecs.getSeqId(first), -1);
        assert.equal([...f.graphics.getActorInstances("npc", 7)].length, 0);
        f.ecs.destroyNpc(first);
        f.receive([24, 0, 7, 1, 44, 0]);
        f.receive([25, 0, 7, 1, 44, 2, 0, 0, 0, 0]);
        const replacement = f.spawn();
        assert.equal(f.ecs.getSeqId(replacement), -1);
        assert.equal([...f.graphics.getActorInstances("npc", 7)].length, 0);
    } finally { f.unsubscribe(); }
});

test("specific sequence applies normal priority and restart rules; a new subscription replays nothing", () => {
    const f = fixture();
    let resubscribed: (() => void) | undefined;
    try {
        const id = f.spawn();
        const strong = new SeqType(300, { game: "oldschool", revision: 241 } as any);
        strong.forcedPriority = 8;
        strong.replyMode = 1;
        const weak = new SeqType(301, { game: "oldschool", revision: 241 } as any);
        weak.forcedPriority = 1;
        f.ecs.setSeqTypeLoader({ load: (seq: number) => seq === 300 ? strong : weak } as any);
        f.receive([24, 0, 7, 1, 44, 0]);
        f.receive([24, 0, 7, 1, 45, 0]);
        assert.equal(f.ecs.getSeqId(id), 300, "a weaker action cannot interrupt the specific sequence");
        f.receive([24, 0, 7, 1, 44, 23]);
        assert.equal(f.ecs.getSeqDelay(id), 23, "the same replyMode1 sequence restarts with new delay");
        f.unsubscribe();
        f.ecs.clearSeq(id);
        resubscribed = subscribeNpcSpecificEffects(effect => applyNpcSpecificEffect(f.ecs, undefined, effect, 200));
        assert.equal(f.ecs.getSeqId(id), -1, "effect subscription has no retained snapshot");
    } finally { f.unsubscribe(); resubscribed?.(); }
});

test("real unmapping clears delayed graphics before index reuse but render mapping transfers retain slots", () => {
    const f = fixture();
    try {
        const original = f.spawn();
        f.receive([25, 0, 7, 1, 44, 2, 0, 0, 2, 88]);
        f.receive([25, 0, 7, 1, 45, 3, 0, 0, 0, 0]);
        f.graphics.spawnAttachedToNpc(302, 8, "ground", undefined, false, 100, 2);
        const transferred = f.spawn();
        f.ecs.destroyNpc(original);
        assert.equal([...f.graphics.getActorInstances("npc", 7)].length, 2, "render mapping transfer is the same live NPC");
        f.ecs.destroyNpc(transferred);
        f.spawn();
        assert.equal([...f.graphics.getActorInstances("npc", 7)].length, 0, "removed/re-entering NPC cannot inherit either graphic slot");
        assert.equal([...f.graphics.getActorInstances("npc", 8)].length, 1, "another NPC's normal slot survives");
        f.receive([25, 0, 7, 1, 46, 2, 0, 0, 0, 0]);
        f.ecs.destroyNpcsForMap(50, 50);
        assert.equal([...f.graphics.getActorInstances("npc", 7)].length, 0, "map removal uses the same unmap cleanup");
        const remapped = f.spawn();
        f.receive([25, 0, 7, 1, 47, 2, 0, 0, 0, 0]);
        f.ecs.setServerMapping(remapped, 9);
        assert.equal([...f.graphics.getActorInstances("npc", 7)].length, 0, "explicit remapping ends the old index lifetime");
    } finally { f.unsubscribe(); }
});

test("a type change sent as remove and re-add in one NPC_INFO keeps graphics; a plain removal clears them", () => {
    const f = fixture();
    try {
        f.spawn();
        const other = f.ecs.createNpc(50, 50, 1, 1, 64, 64, 0, 0, 0, 0);
        f.ecs.setServerMapping(other, 8);
        f.receive([25, 0, 7, 1, 44, 2, 0, 0, 2, 88]);
        f.receive([25, 0, 8, 1, 45, 2, 0, 0, 0, 0]);
        const despawn = (serverId: number) => f.ecs.destroyNpc(f.ecs.getEcsIdForServer(serverId)!);
        const readd = { npcId: 7, typeId: 2, tileX: 3200, tileY: 3200, level: 0, rot: 0, teleport: false, worldViewId: -1 };
        f.ecs.removeForNpcInfo({ removals: [7, 8], spawns: [readd] }, despawn);
        f.spawn();
        assert.equal([...f.graphics.getActorInstances("npc", 7)].length, 1, "the transformed NPC's delayed spot keeps playing");
        assert.equal([...f.graphics.getActorInstances("npc", 8)].length, 0, "an NPC removed in the same NPC_INFO without a re-add loses its spot");
        f.ecs.removeForNpcInfo({ removals: [7], spawns: [] }, despawn);
        assert.equal([...f.graphics.getActorInstances("npc", 7)].length, 0, "a later plain removal clears it");
        f.spawn();
        f.receive([25, 0, 7, 1, 46, 2, 0, 0, 0, 0]);
        f.ecs.destroyNpc(f.ecs.getEcsIdForServer(7)!);
        assert.equal([...f.graphics.getActorInstances("npc", 7)].length, 0, "the re-add exemption ends with its NPC_INFO");
    } finally { f.unsubscribe(); }
});

test("WebGPU NPC graphics use the same real unmap lifecycle and preserve live mapping transfers", async () => {
    (globalThis as any).self = globalThis;
    const { WebGPUActors } = await import("../render/webgpu/actors/WebGPUActors");
    const graphics = new GfxManager({} as any);
    const actors = Object.create(WebGPUActors.prototype) as any;
    actors.gfx = { manager: graphics };
    const ecs = createNpcEcs(() => actors);
    const first = ecs.createNpc(50, 50, 1, 1, 64, 64, 0, 0, 0, 0);
    ecs.setServerMapping(first, 7);
    applyNpcSpecificEffect(ecs, actors, { kind: "spot", index: 7, id: 300, slot: 2, height: 0, delay: 600 }, 100);
    assert.equal([...graphics.getActorInstances("npc", 7)].length, 1);
    ecs.destroyNpc(first);
    assert.equal([...graphics.getActorInstances("npc", 7)].length, 0);
});
