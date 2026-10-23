import { ConfigChanged } from "@runelite/api/events";
import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { OsrsClient } from "../../OsrsClient";

export const NPCIndicatorsConfig = ConfigGroup("npcindicators", {
    names: ConfigItem({ name: "NPC names", description: "One exact NPC name per line. Optional colour: Goblin|#00ff00. Names ignore case.", textArea: true, default: "" }),
    color: ConfigItem({ name: "Default colour", color: true, default: 0x00ffff }),
    fill: ConfigItem({ name: "Fill opacity", units: "%", range: { min: 0, max: 100 }, default: 20 }),
});

export function npcIndicatorRules(text: string, defaultColor: number): { name: string; color: number }[] {
    const names = new Set<string>();
    return text.split(/[\n,]/).flatMap((line) => {
        const [rawName, rawColor] = line.trim().split("|");
        const name = rawName?.trim().toLowerCase();
        if (!name || names.has(name) || names.size >= 128) return [];
        names.add(name);
        const color = /^#[0-9a-f]{6}$/i.test(rawColor?.trim() ?? "") ? parseInt(rawColor.trim().slice(1), 16) : defaultColor;
        return [{ name, color }];
    });
}

/** Scene tile indicators are rebuilt from live actors, so despawns and transforms cannot leave stale tiles. */
export class NPCIndicatorsPlugin extends Plugin {
    static descriptor = { name: "NPC Indicators", description: "Highlight named NPCs on their current tile.", tags: ["npcs", "highlight"], configKey: "npcindicatorsplugin", enabledByDefault: false };
    static config = NPCIndicatorsConfig;
    private readonly manager = inject(ConfigManager);
    private readonly config = this.manager.getConfig(NPCIndicatorsConfig);
    private readonly client: OsrsClient;
    private usedSlots = 0;
    // Reserved exclusively for this plugin; clearing never removes server or quest markers.
    private readonly firstSlot = 62000;

    constructor(client?: OsrsClient) { super(); this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN); }
    getConfig() { return { names: String(this.config.names()), color: Number(this.config.color()), fill: Number(this.config.fill()) }; }
    setConfig(next: Partial<{ names: string; color: number; fill: number }>): void {
        for (const [key, value] of Object.entries(next)) if (value !== undefined) this.manager.setConfigValue(NPCIndicatorsConfig, key, value);
        this.onGameTick();
    }
    onConfigChanged(event: ConfigChanged): void { if (event.getGroup() === NPCIndicatorsConfig.group) this.onGameTick(); }
    onGameStateChanged(): void { this.clear(); }
    protected override async startUp(): Promise<void> { this.onGameTick(); }
    protected override async shutDown(): Promise<void> { this.clear(); }
    private clear(): void {
        for (let i = 0; i < this.usedSlots; i++) this.client.tileHighlightManager.clear(this.firstSlot + i);
        this.usedSlots = 0;
    }
    onGameTick(): void {
        this.clear();
        if (!this.isStarted() || this.client.gameState !== 30) return;
        const client = this.client;
        const local = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId);
        if (local === undefined || !client.npcTypeLoader) return;
        const plane = client.playerEcs.getLevel(local);
        const config = this.getConfig();
        const rules = npcIndicatorRules(config.names, config.color);
        this.usedSlots = rules.length;
        const byName = new Map(rules.map((rule, index) => [rule.name, { ...rule, slot: this.firstSlot + index }]));
        for (const rule of byName.values()) client.tileHighlightManager.configure(rule.slot, rule.color, 2, config.fill, 0);
        for (const id of client.npcEcs.getAllActiveIds()) {
            if (client.npcEcs.getLevel(id) !== plane) continue;
            const base = client.npcTypeLoader.load(client.npcEcs.getNpcTypeId(id));
            const type = base?.transforms ? base.transform(client.varManager, client.npcTypeLoader) : base;
            const rule = type && byName.get(String(type.name ?? "").replace(/<[^>]*>/g, "").trim().toLowerCase());
            if (!rule) continue;
            const x = client.npcEcs.getWorldX(id) >> 7;
            const y = client.npcEcs.getWorldY(id) >> 7;
            client.tileHighlightManager.set((plane << 28) | (x << 14) | y, rule.slot, 0);
        }
    }
}
