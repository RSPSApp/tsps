import assert from "node:assert/strict";

import { createActorHitsplatState } from "../game/actor/ActorOverlayState";
import { getHitsplatOffsetX, getHitsplatOffsetY } from "../game/actor/HitsplatLayout";
import { NpcUpdateDecoder } from "../game/sync/NpcUpdateDecoder";
import { PlayerSyncContext } from "../game/sync/PlayerSyncContext";
import { PlayerUpdateDecoder } from "../game/sync/PlayerUpdateDecoder";
import { addHitSplatOsrs, getHitsplatVisibility } from "../render/render/overlays2";
import {
    createNpcSyncState,
    createPlayerSyncState,
    encodeNpcSync,
    encodePlayerSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

/**
 * Hitsplat slots as the r241 client assigns them (Actor.addHitsplat) with the limit of 8 live
 * sends with every hit (rsprox captures, revisions 237-238): a hit takes the lowest free slot,
 * up to 8 show at once, and each slot's offset comes from HitsplatLayout. Issue #6549.
 */

// Damage splats last 50 cycles (cache hitsplat 16 and 43); a game tick is 30 cycles.
const DISPLAY = 50;
const TICK = 30;

function hostWith(compareType: number): any {
    return { hitsplatOverlay: { getDefinition: () => ({ displayCycles: DISPLAY, compareType }) } };
}

function hit(state: any, host: any, cycle: number, value = 10, limit?: number, delay = 0): number {
    const before = state.hitSplatCycles.map((c: number) => c);
    addHitSplatOsrs(host, state, 16, value, -1, -1, cycle, delay, limit);
    const cycles: number[] = state.hitSplatCycles;
    for (let i = 0; i < cycles.length; i++) if (cycles[i] !== before[i]) return i;
    return -1;
}

/** One hit a tick: live alternates the centre and the slot above it; never left or right. */
function steadyHitsAlternateCentreAndAbove(): void {
    const state = createActorHitsplatState();
    const host = hostWith(-1);
    const slots = [0, 1, 2, 3, 4, 5].map((n) => hit(state, host, n * TICK));
    assert.deepEqual(slots, [0, 1, 0, 1, 0, 1]);
}

/** A lone splat left over from a busy moment does not push the next one round the diamond. */
function nextHitTakesLowestFreeSlot(): void {
    const state = createActorHitsplatState();
    const host = hostWith(-1);
    assert.equal(hit(state, host, 0), 0);
    assert.equal(hit(state, host, 10), 1);
    assert.equal(hit(state, host, 20), 2, "a third while both show goes left");
    // Cycle 65: the first two have expired (50, 60), the left one shows until 70.
    assert.equal(hit(state, host, 65), 0, "the next is centred again, not right");
}

/** Up to 8 at once, at the r241 offsets; a 9th with no replacement mode is not shown. */
function eightShowAtOnce(): void {
    const state = createActorHitsplatState();
    const host = hostWith(-1);
    const slots = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => hit(state, host, i));
    assert.deepEqual(slots, [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(hit(state, host, 8), -1, "the 9th is dropped");
    assert.equal(state.hitSplatCycles.length, 8);
    for (let slot = 0; slot < 8; slot++) {
        assert.notEqual(getHitsplatVisibility(host, state, slot, 8), undefined, `slot ${slot} shows`);
    }
    const offsets = [0, 1, 2, 3, 4, 5, 6, 7].map((s) => [getHitsplatOffsetX(s), getHitsplatOffsetY(s)]);
    assert.deepEqual(offsets, [
        [0, 0], [0, -20], [-15, -10], [15, -10], [15, 10], [0, 20], [-15, 10], [-30, -10],
    ]);
}

/** With every slot showing, replacement mode 0 takes the one expiring first, 1 the lowest. */
function fullListReplacement(): void {
    let state = createActorHitsplatState();
    let host = hostWith(0);
    for (let i = 0; i < 8; i++) hit(state, host, i);
    assert.equal(hit(state, host, 8), 0, "mode 0: the oldest");

    state = createActorHitsplatState();
    host = hostWith(1);
    for (let i = 0; i < 8; i++) hit(state, host, i, i === 5 ? 1 : 20);
    assert.equal(hit(state, host, 8, 1), -1, "mode 1: not over a splat as big");
    assert.equal(hit(state, host, 8, 7), 5, "mode 1: over the lowest");
}

/** A limit of 4 or less keeps the old rotation: the slot after the last one showing. */
function smallLimitRotates(): void {
    const state = createActorHitsplatState();
    const host = hostWith(-1);
    assert.deepEqual([0, 1, 2].map((n) => hit(state, host, n * TICK, 10, 4)), [0, 1, 2]);
}

/** A delayed hit holds its slot before it shows; a hit with no type takes none. */
function delayAndUntyped(): void {
    const state = createActorHitsplatState();
    const host = hostWith(-1);
    assert.equal(hit(state, host, 0, 10, 8, 40), 0);
    assert.equal(getHitsplatVisibility(host, state, 0, 20), undefined, "not shown during its delay");
    assert.notEqual(getHitsplatVisibility(host, state, 0, 40), undefined, "shown after it");
    assert.equal(hit(state, host, 10), 1, "its slot is taken meanwhile");
    addHitSplatOsrs(host, state, -1, 0, -1, -1, 20, 0, 8);
    assert.equal(state.hitSplatCycles.length, 2, "type -1 adds nothing");
}

/** The limit goes over the wire with each hit, for NPCs and players. */
function limitRoundTrip(): void {
    const npcState = createNpcSyncState();
    const npcDecoder = new NpcUpdateDecoder();
    const local = { x: 3200, y: 3200, level: 0 };
    const npc = (extra: object = {}) => ({
        index: 9, typeId: 14707, x: 3203, y: 3204, level: 0,
        rotation: 0, walkDirection: -1, runDirection: -1, ...extra,
    });
    const decodeNpcs = (packet: Buffer) => {
        const body = packet.subarray(3);
        const length = body.readUInt16BE(9);
        return npcDecoder.decode(body.subarray(11, 11 + length), {
            large: body[4] === 1, loopCycle: 0, clientCycle: 0,
            localTileX: 3200, localTileY: 3200, level: 0,
        });
    };
    decodeNpcs(encodeNpcSync(1, local, [npc() as any], npcState));
    const npcHits = decodeNpcs(encodeNpcSync(2, local, [npc({
        hits: [{ type: 16, damage: 43 }, { type: 12, damage: 0, delay: 20 }],
        health: { current: 51, max: 500 },
    }) as any], npcState)).updateBlocks.get(9)?.hitsplats;
    assert.deepEqual(npcHits?.map((h) => [h.type, h.damage, h.delayCycles, h.limit]), [
        [16, 43, 0, 8],
        [12, 0, 20, 8],
    ]);

    const base = { x: 3392, y: 6400 };
    const tile = { x: 3422, y: 6432, level: 0 };
    const playerState = createPlayerSyncState(1, tile);
    const ctx = new PlayerSyncContext();
    ctx.setBase(base.x, base.y);
    ctx.setLocalIndex(1);
    ctx.activate(1, tile);
    for (const empty of ctx.emptyIndices) ctx.flags[empty] = 1;
    const view: any = { index: 1, ...tile, appearance: Buffer.alloc(0) };
    const decodePlayers = (tick: number) => {
        const data = encodePlayerSync(1, base.x, base.y, tick, [view], playerState).subarray(3);
        const length = data.readUInt16BE(10);
        return new PlayerUpdateDecoder().decode(data.subarray(12, 12 + length), ctx, {
            packetSize: length,
            loopCycle: tick,
        });
    };
    decodePlayers(1);
    Object.assign(view, { hits: [{ type: 17, damage: 28 }], health: { current: 50, max: 99 } });
    const playerHits = decodePlayers(2).updateBlocks.get(1)?.hitsplats;
    assert.deepEqual(playerHits?.map((h) => [h.type, h.damage, h.delayCycles, h.limit]), [[17, 28, 0, 8]]);
}

steadyHitsAlternateCentreAndAbove();
nextHitTakesLowestFreeSlot();
eightShowAtOnce();
fullListReplacement();
smallLimitRotates();
delayAndUntyped();
limitRoundTrip();
console.log("hitsplat-slots: ok");
