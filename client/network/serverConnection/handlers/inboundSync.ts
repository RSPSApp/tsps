import { ClientState } from "../../../game/ClientState";
import {
    VARP_AREA_SOUNDS_VOLUME,
    VARP_COMBAT_TARGET_PLAYER_INDEX,
    VARP_FOLLOWER_INDEX,
    VARP_MASTER_VOLUME,
    VARP_MUSIC_VOLUME,
    VARP_OPTION_ATTACK_PRIORITY_NPC,
    VARP_OPTION_ATTACK_PRIORITY_PLAYER,
    VARP_SOUND_EFFECTS_VOLUME,
} from "../../../common/vars";
import { send } from "../connection/send";
import { emitCollectionLog, emitInventory } from "../domain/inventory";
import { handleShopPayload } from "../domain/shop";
import { handleSmithingPayload } from "../domain/smithing";
import { emitPlayerSync, emitSkills } from "../domain/skills";
import { handleTradePayload } from "../domain/trade";
import { getClientCycle } from "../timing";
import { cloneRunEnergyState, state } from "../state";
import {
    BANK_SLOT_COUNT_FALLBACK,
    DEFAULT_SERVER_TICK_MS,
    RUN_ENERGY_MAX_UNITS,
} from "../constants";
import type {
    BankServerUpdate,
    ChatMessageEvent,
    GroundItemsServerPayload,
    NotificationEvent,
    RunEnergyPayload,
    RunEnergyState,
    ShopServerPayload,
    SmithingServerPayload,
    SkillsServerPayload,
    SpotAnimationPayload,
    TradeServerPayload,
} from "../types";
import type { WidgetServerPayload } from "../types/widgets";
import { decodeBase64 } from "../utils/decodeBase64";
import { applyGroundItemsDelta, cloneGroundItemsPayload } from "../utils/groundItems";
import { sanitizeBankSlotMessage, sanitizeInventorySlotMessage, sanitizeSpellResult } from "../utils/sanitize";

export function handleInboundSync(msg: any): boolean {
    if (msg.type === "rebuild_region") {
        ClientState.inInstance = true;
        ClientState.instanceTemplateChunks = msg.payload.templateChunks;
        ClientState.regionX = msg.payload.regionX;
        ClientState.regionY = msg.payload.regionY;
        for (const cb of state.rebuildRegionListeners) {
            try {
                cb(msg.payload);
            } catch {}
        }
        return true;
    }
    if (msg.type === "rebuild_normal") {
        ClientState.inInstance = false;
        ClientState.instanceTemplateChunks = null;
        ClientState.regionX = msg.payload.regionX;
        ClientState.regionY = msg.payload.regionY;
        for (const cb of state.rebuildNormalListeners) {
            try {
                cb(msg.payload);
            } catch {}
        }
        return true;
    }
    if (msg.type === "rebuild_worldentity") {
        // World entity overlays don't change instance state —
        // they render on top of the normal world.
        for (const cb of state.rebuildWorldEntityListeners) {
            try {
                cb(msg.payload);
            } catch {}
        }
        return true;
    }
    if (msg.type === "worldentity_info") {
        for (const cb of state.worldEntityInfoListeners) {
            try {
                cb(msg.payload);
            } catch (err) {
                console.warn("[ws] worldentity_info listener error:", err);
            }
        }
        return true;
    }
    if (msg.type === "path") {
        const { id, ok, waypoints, message } = msg.payload;
        const cb = state.pending.get(id);
        if (cb) {
            state.pending.delete(id);
            cb({ ok, waypoints, message });
        }
        try {
            state.lastServerPath = Array.isArray(waypoints)
                ? waypoints.map((w: any) => ({ x: Number(w.x) | 0, y: Number(w.y) | 0 }))
                : undefined;
            for (const fn of state.pathDebugListeners) fn(state.lastServerPath);
        } catch {}
        return true;
    }
    if (msg.type === "player_sync") {
        if (!state.playerSyncContext || !state.playerUpdateDecoder) return true;
        try {
            const payload = msg.payload as any;
            const baseX = Number(payload?.baseX) | 0;
            const baseY = Number(payload?.baseY) | 0;
            if (!Number.isFinite(payload?.localIndex)) return true;
            const localIndex = Number(payload.localIndex) | 0;
            if (localIndex < 0 || localIndex >= 2048) {
                console.warn("[ws] player_sync invalid localIndex", localIndex, "dropping frame");
                return true;
            }
            const loopCycle = Number(payload?.loopCycle) | 0;
            const clientCycle = getClientCycle();

            let buffer: Uint8Array;
            const pkt = payload?.packet;
            if (pkt instanceof Uint8Array) {
                buffer = pkt;
            } else if (Array.isArray(pkt) || ArrayBuffer.isView(pkt)) {
                const arr = Array.from(pkt as ArrayLike<number>, (n) => Number(n) & 0xff);
                buffer = new Uint8Array(arr);
            } else {
                buffer = decodeBase64(typeof pkt === "string" ? pkt : String(pkt ?? ""));
            }

            if (!buffer || buffer.length === 0) return true;

            state.playerSyncContext.setBase(baseX, baseY);
            state.playerSyncContext.setLocalIndex(localIndex);
            // baseX/baseY are the scene base in *tiles* (8-aligned).
            // Local coords are in 0..103 and world = base + local.
            ClientState.baseX = baseX | 0;
            ClientState.baseY = baseY | 0;
            const frame = state.playerUpdateDecoder.decode(
                buffer ?? new Uint8Array(0),
                state.playerSyncContext,
                {
                    packetSize: buffer?.length ?? 0,
                    loopCycle,
                    clientCycle,
                },
            );
            (frame as any).sourcePacketSize = buffer?.length ?? 0;
            try {
                if ((globalThis as any).__syncDebug === true) {
                    const localState = state.playerSyncContext.stateFor(localIndex);
                    console.log("[sync-debug] player_sync", {
                        baseX,
                        baseY,
                        localIndex,
                        localTile: localState?.active
                            ? {
                                  x: localState.tileX | 0,
                                  y: localState.tileY | 0,
                                  level: localState.level | 0,
                              }
                            : undefined,
                        loopCycle,
                        packetSize: buffer.length | 0,
                    });
                }
            } catch {}

            if (Array.isArray(payload?.interactions)) {
                for (const entry of payload.interactions as any[]) {
                    const id = Number(entry?.id);
                    if (!Number.isFinite(id)) continue;
                    const rawIndex = Number(entry?.interactionIndex);
                    const block = frame.updateBlocks.get(id) ?? {};
                    block.faceEntity = Number.isFinite(rawIndex) ? rawIndex | 0 : -1;
                    frame.updateBlocks.set(id, block);
                }
            }

            emitPlayerSync(frame);
        } catch (err) {
            console.warn("failed to process player_sync payload", err);
            try {
                // The client hard-fails on malformed updatePlayers streams.
                // In this dev client, force a reconnect to resynchronise player sync state.
                const message = (err as any)?.message?.toString?.() ?? "";
                if (
                    err instanceof RangeError ||
                    message.includes("Buffer exhausted") ||
                    message.includes("player sync:")
                ) {
                    state.socket?.close(1002, "player_sync_desync");
                }
            } catch {}
        }
        return true;
    }
    if (msg.type === "debug") {
        const payload: any = msg.payload;
        if (payload?.kind === "anim_request") {
            try {
                const reqId = Number(payload.requestId) | 0;
                const snap = state.animDebugProvider?.();
                if (snap) {
                    send({
                        type: "debug",
                        payload: {
                            kind: "anim_snapshot",
                            requestId: reqId,
                            snapshot: snap,
                        },
                    } as any);
                }
            } catch (err) {
                console.warn("[debug] anim snapshot failed", err);
            }
        }
        return true;
    }
    if (msg.type === "npc_info") {
        try {
            const payload = msg.payload as any;
            const loopCycle = Number(payload?.loopCycle) | 0;
            const large = payload?.large === true;
            const rootTileX = Number(payload?.rootTileX) | 0;
            const rootTileY = Number(payload?.rootTileY) | 0;
            let buffer: Uint8Array;
            const pkt = payload?.packet;
            if (pkt instanceof Uint8Array) {
                buffer = pkt;
            } else if (Array.isArray(pkt) || ArrayBuffer.isView(pkt)) {
                const arr = Array.from(pkt as ArrayLike<number>, (n) => Number(n) & 0xff);
                buffer = new Uint8Array(arr);
            } else {
                buffer = decodeBase64(typeof pkt === "string" ? pkt : String(pkt ?? ""));
            }
            if (!buffer || buffer.length === 0) return true;
            for (const cb of state.npcInfoListeners) {
                try {
                    cb({ loopCycle, large, rootTileX, rootTileY, packet: buffer });
                } catch (err) {
                    console.warn("npc_info listener error", err);
                }
            }
        } catch (err) {
            console.warn("failed to process npc_info payload", err);
        }
        return true;
    }
    if (msg.type === "spell_result") {
        const payload = sanitizeSpellResult(msg.payload);
        state.lastSpellResult = payload;
        for (const cb of state.spellResultListeners) {
            try {
                cb({
                    ...payload,
                    runesConsumed: payload.runesConsumed
                        ? payload.runesConsumed.map((entry) => ({ ...entry }))
                        : undefined,
                    runesRefunded: payload.runesRefunded
                        ? payload.runesRefunded.map((entry) => ({ ...entry }))
                        : undefined,
                    tile: payload.tile ? { ...payload.tile } : undefined,
                    modifiers: payload.modifiers ? { ...payload.modifiers } : undefined,
                });
            } catch (err) {
                console.warn("spell_result listener error", err);
            }
        }
        return true;
    }
    if (msg.type === "projectiles") {
        const list = msg.payload.list;
        for (const p of list) {
            for (const cb of state.projectileListeners) {
                try {
                    cb(p);
                } catch (err) {
                    console.warn("projectile listener error", err);
                }
            }
        }
        return true;
    }
    if (msg.type === "spot") {
        const raw = msg.payload as SpotAnimationPayload | undefined;
        if (!raw || typeof raw.spotId !== "number") return true;
        const payload: SpotAnimationPayload = {
            spotId: raw.spotId | 0,
            delay: raw.delay,
            height: raw.height,
        };
        if (typeof raw.playerId === "number") payload.playerId = raw.playerId | 0;
        if (typeof raw.npcId === "number") payload.npcId = raw.npcId | 0;
        if (raw.tile && typeof raw.tile.x === "number" && typeof raw.tile.y === "number") {
            payload.tile = {
                x: raw.tile.x | 0,
                y: raw.tile.y | 0,
                level:
                    typeof raw.tile.level === "number" ? (raw.tile.level as number) | 0 : undefined,
            };
        }
        for (const cb of state.spotListeners) {
            try {
                cb(payload);
            } catch (err) {
                console.warn("spot listener error", err);
            }
        }
        return true;
    }
    if (msg.type === "anim") {
        state.lastAnim = msg.payload;
        for (const cb of state.animListeners) cb(msg.payload);
        return true;
    }
    if (msg.type === "handshake") {
        state.lastHandshake = msg.payload as any;
        for (const cb of state.handshakeListeners) cb(msg.payload as any);
        try {
            const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
            if (canvas) {
                const ui: any = ((canvas as any).__ui = (canvas as any).__ui || {});
                ui.chatbox = ui.chatbox || {};
                if (Array.isArray((msg.payload as any).chatIcons)) {
                    ui.chatbox.defaultIcons = (msg.payload as any).chatIcons.slice();
                }
                if (typeof (msg.payload as any).chatPrefix === "string") {
                    ui.chatbox.defaultPrefix = String((msg.payload as any).chatPrefix);
                }
            }
        } catch {}
        return true;
    }
    return false;
}
