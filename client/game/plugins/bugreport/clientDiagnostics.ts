import { isMobileMode } from "../../../common/utils/DeviceUtil";
import { getLatestSkills } from "../../../network/serverConnection/subscriptions/ui";
import { getCurrentTick } from "../../../network/serverConnection/timing";
import type { Inventory } from "../../../rs/inventory/Inventory";
import { chatHistory } from "../../../rs/cs2/ChatHistory";
import type { OsrsClient } from "../../OsrsClient";
import type { ClientLogBuffer } from "./ClientLogBuffer";

const GAME_MESSAGE_TYPE = 0;
const MAX_MESSAGES = 50;

/** A section that fails to read is left out rather than losing the report. */
function read<T>(section: () => T): T | undefined {
    try {
        return section();
    } catch (error) {
        console.warn("[bug-report] diagnostics section failed", error);
        return undefined;
    }
}

function items(client: OsrsClient, inventory: Inventory) {
    return inventory.getSlots()
        .filter((slot) => slot.itemId >= 0 && slot.quantity > 0)
        .map((slot) => ({
            slot: slot.slot,
            id: slot.itemId,
            name: read(() => client.objTypeLoader.load(slot.itemId)?.name),
            quantity: slot.quantity,
        }));
}

function position(client: OsrsClient) {
    const index = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId);
    if (index === undefined || index < 0) return undefined;
    return {
        x: client.playerEcs.getX(index) >> 7,
        y: client.playerEcs.getY(index) >> 7,
        plane: client.playerEcs.getLevel(index),
    };
}

function varps(client: OsrsClient): Record<number, number> {
    const values: Record<number, number> = {};
    client.varManager.values.forEach((value, id) => {
        if (value !== 0) values[id] = value;
    });
    return values;
}

function plugins(client: OsrsClient) {
    const manager = client.runeLite.pluginManager;
    const failed: Record<string, string> = {};
    for (const pluginClass of manager.getPluginClasses()) {
        const failure = manager.getFailure(pluginClass);
        if (failure) failed[pluginClass.descriptor.name] = failure;
    }
    return { enabled: manager.getEnabledPlugins().map((plugin) => plugin.getName()), failed };
}

/**
 * What the client knows as the report is sent. Only named fields are read: the login and
 * connection state also hold the player's password. Game messages only, no player chat; the
 * log buffer leaves the text of chat and dialogs out of the console lines.
 */
export function collectClientDiagnostics(client: OsrsClient, logs: ClientLogBuffer) {
    return {
        capturedAt: new Date().toISOString(),
        client: read(() => ({
            userAgent: navigator.userAgent,
            language: navigator.language,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            page: `${window.location.origin}${window.location.pathname}`,
            viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
            renderer: client.renderer.type,
            fps: Math.round(client.renderer.stats.frameTimeFps),
            mobile: isMobileMode,
            cache: client.loadedCache?.info.name,
        })),
        world: read(() => ({
            name: client.loginState.serverName,
            address: client.loginState.serverAddress,
            transport: client.loginState.serverTransport,
            members: client.isMembersWorld,
            tick: getCurrentTick(),
        })),
        player: read(() => ({
            name: client.localPlayerName,
            serverId: client.controlledPlayerServerId,
            position: position(client),
        })),
        inventory: read(() => items(client, client.inventory)),
        equipment: read(() => items(client, client.equipment)),
        skills: read(() => getLatestSkills()),
        varps: read(() => varps(client)),
        interfaces: read(() => ({
            root: client.widgetManager.rootInterface,
            mounted: [...client.widgetManager.interfaceParents].map(([container, parent]) =>
                ({ container, group: parent.group, type: parent.type })),
        })),
        plugins: read(() => plugins(client)),
        messages: read(() => chatHistory.getAllMessageNodes()
            .filter((message) => message.type === GAME_MESSAGE_TYPE)
            .slice(-MAX_MESSAGES)
            .map((message) => ({ time: message.timestamp, text: message.text }))),
        logs: logs.recent(),
    };
}
