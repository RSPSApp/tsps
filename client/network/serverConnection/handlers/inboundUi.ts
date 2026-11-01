import { applyClanChannelDelta, applyClanSettingsDelta } from "../../../common/social/Clans";
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
import { markChatTransmit, markItemDefinitionsChanged } from "../../../game/TransmitCycles";
import { CustomItemRegistry } from "../../../custom/items/CustomItemRegistry";
import { getDefinitionArchiveKey } from "../../../custom/archives/ArchivedDefinitionStore";
import { getClientCycle } from "../timing";
import { cloneRunEnergyState, state } from "../state";
import {
    BANK_SLOT_COUNT_FALLBACK,
    DEFAULT_SERVER_TICK_MS,
    RUN_ENERGY_MAX_UNITS,
} from "../constants";
import type { CombatStatePayload } from "../../combat/CombatStateStore";
import type {
    BankServerUpdate,
    ChatMessageEvent,
    GroundItemsServerPayload,
    FriendsChatSnapshot,
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

export function handleInboundUi(msg: any): boolean {
    if (msg.type === "inventory") {
        const payload: any = msg.payload;
        if (!payload) return true;
        if (payload.kind === "snapshot") {
            const slots = Array.isArray(payload.slots)
                ? payload.slots.map((slot: any) => sanitizeInventorySlotMessage(slot))
                : [];
            emitInventory({ kind: "snapshot", slots });
        } else if (payload.kind === "slot") {
            if (payload.slot) {
                emitInventory({
                    kind: "slot",
                    slot: sanitizeInventorySlotMessage(payload.slot),
                });
            }
        }
        return true;
    }
    if (msg.type === "collection_log") {
        const payload: any = msg.payload;
        if (!payload) return true;
        if (payload.kind === "snapshot") {
            const slots = Array.isArray(payload.slots)
                ? payload.slots.map((slot: any) => sanitizeInventorySlotMessage(slot))
                : [];
            emitCollectionLog({ kind: "snapshot", slots });
        }
        return true;
    }
    if (msg.type === "bank") {
        const payload = msg.payload as BankServerUpdate;
        if (!payload) return true;
        if (payload.kind === "snapshot") {
            const capacity = Math.max(1, Number(payload.capacity) | 0);
            const slots = Array.isArray(payload.slots)
                ? payload.slots.map((slot) => sanitizeBankSlotMessage(slot, capacity))
                : [];
            state.lastBankState = {
                capacity,
                slots: slots.map((slot) => ({ ...slot })),
            };
            const snapshotPayload: BankServerUpdate = {
                kind: "snapshot",
                capacity,
                slots: slots.map((slot) => ({ ...slot })),
            };
            for (const cb of state.bankListeners) {
                try {
                    cb(snapshotPayload);
                } catch (err) {
                    console.warn("bank listener error", err);
                }
            }
        } else if (payload.kind === "slot") {
            const capacityHint = state.lastBankState?.capacity ?? BANK_SLOT_COUNT_FALLBACK;
            const slot = sanitizeBankSlotMessage(payload.slot, capacityHint);
            if (state.lastBankState) {
                const idx = state.lastBankState.slots.findIndex((s) => (s.slot | 0) === (slot.slot | 0));
                if (idx >= 0) state.lastBankState.slots[idx] = { ...slot };
                else state.lastBankState.slots.push({ ...slot });
            }
            for (const cb of state.bankListeners) {
                try {
                    cb({ kind: "slot", slot: { ...slot } });
                } catch (err) {
                    console.warn("bank listener error", err);
                }
            }
        }
        return true;
    }
    if (msg.type === "shop") {
        handleShopPayload(msg.payload as ShopServerPayload);
        return true;
    }
    if (msg.type === "ground_items") {
        try {
            const normalized = cloneGroundItemsPayload(msg.payload as GroundItemsServerPayload);
            if (normalized.kind === "snapshot") {
                state.lastGroundItems = normalized;
            } else {
                state.lastGroundItems = applyGroundItemsDelta(state.lastGroundItems, normalized);
            }
            for (const cb of state.groundItemListeners) {
                try {
                    cb(cloneGroundItemsPayload(normalized));
                } catch (err) {
                    console.warn("ground item listener error", err);
                }
            }
        } catch (err) {
            console.warn("ground_items handler error", err);
        }
        return true;
    }
    if (msg.type === "smithing") {
        handleSmithingPayload(msg.payload as SmithingServerPayload);
        return true;
    }
    if (msg.type === "trade") {
        handleTradePayload(msg.payload as TradeServerPayload);
        return true;
    }
    if (msg.type === "skills") {
        emitSkills(msg.payload as SkillsServerPayload);
        return true;
    }
    if (msg.type === "combat") {
        state.combatStateStore.ingest(msg.payload as CombatStatePayload | undefined);
        return true;
    }
    if (msg.type === "run_energy") {
        const raw = msg.payload as RunEnergyPayload | undefined;
        const percentRaw = Number(raw?.percent);
        const percent = Number.isFinite(percentRaw)
            ? Math.max(0, Math.min(100, percentRaw | 0))
            : (state.lastRunEnergyState?.percent ?? 100);
        const unitsRaw = Number(raw?.units);
        const units = Number.isFinite(unitsRaw)
            ? Math.max(0, Math.min(RUN_ENERGY_MAX_UNITS, unitsRaw | 0))
            : Math.round((percent / 100) * RUN_ENERGY_MAX_UNITS);
        const running =
            raw && Object.prototype.hasOwnProperty.call(raw, "running")
                ? !!raw?.running
                : (state.lastRunEnergyState?.running ?? true);
        const weightRaw = Number(raw?.weight);
        const weight = Number.isFinite(weightRaw)
            ? weightRaw | 0
            : (state.lastRunEnergyState?.weight ?? 0);
        let stamina: RunEnergyState["stamina"] | undefined;
        const staminaTicksRaw = Number(raw?.staminaTicks);
        const staminaMultiplierRaw = Number(raw?.staminaMultiplier);
        if (
            Number.isFinite(staminaTicksRaw) &&
            staminaTicksRaw > 0 &&
            Number.isFinite(staminaMultiplierRaw) &&
            staminaMultiplierRaw > 0
        ) {
            const tickMsRaw = Number(raw?.staminaTickMs);
            const msPerTick =
                Number.isFinite(tickMsRaw) && tickMsRaw > 0 ? tickMsRaw : DEFAULT_SERVER_TICK_MS;
            stamina = {
                ticks: staminaTicksRaw | 0,
                msPerTick,
                multiplier: staminaMultiplierRaw,
                expiresAt: Date.now() + (staminaTicksRaw | 0) * msPerTick,
            };
        }
        const runEnergySnapshot: RunEnergyState = stamina
            ? { percent, units, running, weight, stamina }
            : { percent, units, running, weight };
        state.lastRunEnergyState = cloneRunEnergyState(runEnergySnapshot);
        for (const cb of state.runEnergyListeners) {
            try {
                cb(cloneRunEnergyState(runEnergySnapshot));
            } catch (err) {
                console.warn("run energy listener error", err);
            }
        }
        return true;
    }
    if (msg.type === "widget") {
        if (msg.payload.action !== "set_text" && (msg.payload as any).uid !== 10616865) {
            console.log("[ServerConnection] recv widget", msg.payload);
        }
        const payload = msg.payload as WidgetServerPayload;
        for (const cb of state.widgetListeners) cb(payload);
        return true;
    }
    if (msg.type === "chat") {
        const payload = msg.payload;
        try {
            const event: ChatMessageEvent = {
                messageType: payload.messageType,
                chatType: payload.chatType,
                text: payload.text,
                from: payload.from,
                prefix: payload.prefix,
                playerId: payload.playerId,
            };
            for (const cb of state.chatMessageListeners) cb(event);
        } catch (err) {
            console.warn("chat listener error", err);
        }
        return true;
    }
    if (msg.type === "chat_filter_settings") {
        // The server's saved filters; the chatbox buttons redraw on the chat transmit.
        const payload = msg.payload as { publicMode: number; privateMode: number; tradeMode: number };
        const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
        const vm = g?.__osrsClient?.cs2Vm;
        if (vm) {
            vm.publicChatMode = payload.publicMode | 0;
            vm.privateChatMode = payload.privateMode | 0;
            vm.tradeChatMode = payload.tradeMode | 0;
        }
        markChatTransmit();
        return true;
    }
    if (msg.type === "friends_chat") {
        const snapshot = msg.payload as FriendsChatSnapshot;
        state.lastFriendsChat = snapshot;
        for (const cb of state.friendsChatListeners) {
            try {
                cb(snapshot);
            } catch (err) {
                console.warn("friends chat listener error", err);
            }
        }
        return true;
    }
    if (
        msg.type === "clan_settings" ||
        msg.type === "clan_settings_delta" ||
        msg.type === "clan_channel" ||
        msg.type === "clan_channel_delta" ||
        msg.type === "clan_var"
    ) {
        applyClanMessage(msg);
        for (const cb of state.clanListeners) {
            try {
                cb(state.clans);
            } catch (err) {
                console.warn("clan listener error", err);
            }
        }
        return true;
    }
    if (msg.type === "gamemode_data") {
        const datasets = msg.payload?.datasets;
        if (datasets?.length === 1 && datasets[0].key === "worldMapPlayers") {
            // Staff world map dots: [x, y, plane, isBot] rows, drawn by the map renderer.
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            if (g.__osrsClient) g.__osrsClient.worldMapPlayers = datasets[0].rows;
            return true;
        }
        try {
            const { loadFromPayload } = require("../../../common/gamemode/GamemodeContentStore");
            const itemRevision = CustomItemRegistry.revision;
            const archiveKey = getDefinitionArchiveKey();
            loadFromPayload(msg.payload);
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (msg.payload?.datasets?.some((dataset: any) =>
                dataset.key === "customItems" || dataset.key === "customModels" ||
                dataset.key === "definitionArchives")) {
                mv?.objTypeLoader?.clearCache();
                mv?.objModelLoader?.clearCache();
                if (datasets?.some((dataset: any) => dataset.key === "definitionArchives")) {
                    mv?.npcTypeLoader?.clearCache();
                    mv?.locTypeLoader?.clearCache();
                    mv?.renderer?.invalidateDefinitionCaches();
                }
                mv?.workerPool?.runAll((worker: any) => worker.setCustomContent(msg.payload))
                    .catch((error: unknown) => console.error("Custom worker content failed", error));
            }
            if (CustomItemRegistry.revision !== itemRevision || getDefinitionArchiveKey() !== archiveKey) {
                markItemDefinitionsChanged();
            }
            if (mv && typeof mv.refreshGamemodeWorldLocs === "function") {
                mv.refreshGamemodeWorldLocs();
            }
            console.log(`[ws] gamemode_data loaded: ${msg.payload?.gamemodeId ?? "unknown"}`);
        } catch (err) {
            console.log("[ws] failed to load gamemode_data", err);
        }
        return true;
    }
    if (msg.type === "notification") {
        const payload = msg.payload as NotificationEvent;
        for (const cb of state.notificationListeners) cb(payload);
        return true;
    }
    if (msg.type === "system_update") {
        const payload = msg.payload as { remainingCentis?: number } | undefined;
        const raw = Number(payload?.remainingCentis);
        const remainingCentis = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
        state.lastSystemUpdate = { remainingCentis, receivedAtMs: Date.now() };
        for (const cb of state.systemUpdateListeners) {
            try {
                cb({ remainingCentis });
            } catch (err) {
                console.warn("system update listener error", err);
            }
        }
        return true;
    }
    return false;
}

function applyClanMessage(msg: any): void {
    if (msg.type === "clan_var") {
        state.clans.vars.set(msg.payload.id, msg.payload.value);
        return;
    }
    const { clanType } = msg.payload;
    const { settings, channels } = state.clans;
    if (msg.type === "clan_settings") {
        if (msg.payload.settings) settings.set(clanType, msg.payload.settings);
        else settings.delete(clanType);
    } else if (msg.type === "clan_settings_delta") {
        const held = settings.get(clanType);
        if (held) settings.set(clanType, applyClanSettingsDelta(held, msg.payload.updates));
    } else if (msg.type === "clan_channel") {
        if (msg.payload.channel) channels.set(clanType, msg.payload.channel);
        else channels.delete(clanType);
    } else {
        const channel = applyClanChannelDelta(channels.get(clanType), msg.payload);
        if (channel) channels.set(clanType, channel);
    }
}
