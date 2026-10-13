import { emitPluginMessage } from "../domain/pluginMessages";
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

import { handleAuthTickMessage } from "./authTick";
import { handleInboundSync } from "./inboundSync";
import { handleInboundUi } from "./inboundUi";
import { handleInboundWorld } from "./inboundWorld";

export function processServerMessage(msg: any): void {
    if (msg.type === "plugin_message") {
        emitPluginMessage(msg.payload);
        return;
    }
    if (handleAuthTickMessage(msg)) return;
    if (handleInboundSync(msg)) return;
    if (handleInboundUi(msg)) return;
    handleInboundWorld(msg);
}
