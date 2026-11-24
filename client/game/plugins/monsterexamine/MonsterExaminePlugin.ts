import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { send } from "../../../network/serverConnection/connection/send";
import { MENU_ACTION_DEPRIORITIZE_OFFSET } from "../../../ui/menu/MenuAction";
import { MenuOpcode } from "../../../ui/menu/MenuState";
import type { MenuActionData } from "../../../ui/menu/menuEvents";
import type { OsrsClient } from "../../OsrsClient";
import type { GameStateChanged, PluginMessage } from "@runelite/api/events";
import type { WorldMapOverlayContext } from "../ClientPluginManager";
import { BestiaryPins } from "./BestiaryPins";

/** Opts NPC examines into the server's native monster window while enabled. */
export class MonsterExaminePlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Monster Examine",
        description: "Examine monsters, browse the Bestiary and find known spawns on the minimap and world map",
        tags: ["npc", "combat", "stats", "drops", "examine", "bestiary", "find"],
        enabledByDefault: true,
        configKey: "monsterexamineplugin",
    };

    private readonly client: OsrsClient;
    readonly pins: BestiaryPins;

    constructor(client?: OsrsClient) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.pins = new BestiaryPins(this.client);
    }

    protected async startUp(): Promise<void> { this.pins.start(); }
    protected async shutDown(): Promise<void> { this.pins.stop(); }
    widgetOverlays(): BestiaryPins[] { return this.isStarted() ? [this.pins] : []; }
    onPluginMessage(event: PluginMessage): void { if (this.isStarted()) this.pins.onPluginMessage(event); }
    onGameStateChanged(event: GameStateChanged): void { if (this.isStarted()) this.pins.onGameStateChanged(event); }
    drawWorldMap(context: WorldMapOverlayContext): void { if (this.isStarted()) this.pins.drawWorldMap(context); }

    onMenuOptionClicked(action: MenuActionData): boolean {
        if (!this.isStarted()) return false;
        const opcode = action.opcode >= MENU_ACTION_DEPRIORITIZE_OFFSET
            ? action.opcode - MENU_ACTION_DEPRIORITIZE_OFFSET : action.opcode;
        if (opcode !== MenuOpcode.ExamineNpc) return false;
        const index = action.identifier;
        if (!Number.isInteger(index) || index < 0) return false;
        const id = this.client.resolveNpcExamineTypeId(index);
        if (id === undefined || id < 0) return false;
        // The server validates the live entity and falls back to text for ordinary
        // NPCs, protected interactions, or a disabled/uninstalled server plugin.
        send({ type: "plugin_message", payload: { channel: "entity-examine",
            data: { kind: "npc", id, index } } });
        return true;
    }
}
