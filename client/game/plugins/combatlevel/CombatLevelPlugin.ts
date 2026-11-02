import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import type { StatChanged } from "@runelite/api/events";
import type { ConfigChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { OsrsClient } from "../../OsrsClient";
import { SkillId } from "../../../rs/skill/skills";
import type { WidgetOverlay } from "../ClientPluginManager";
import { CombatLevelConfig } from "./CombatLevelConfig";
import { combatLevel, formatPreciseCombatLevel, nextCombatLevels, preciseCombatLevel, type CombatLevels, type NextCombatLevels } from "./CombatLevel";
import { CombatLevelOverlay } from "./CombatLevelOverlay";

const COMBAT_GROUP = 593;
const COMBAT_LEVEL_UID = (COMBAT_GROUP << 16) | 4;
const SCRIPT_COMBAT_INTERFACE_SETUP = 7593;
const SKILL_KEYS = ["attack", "defence", "strength", "hitpoints", "ranged", "prayer", "magic"] as const;
const SKILL_IDS = [SkillId.Attack, SkillId.Defence, SkillId.Strength, SkillId.Hitpoints, SkillId.Ranged, SkillId.Prayer, SkillId.Magic] as const;

/** RuneLite Combat Level plugin. It updates Combat Options only; account summary and Wilderness widgets remain unchanged. */
export class CombatLevelPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Combat Level",
        description: "Shows your precise combat level and next combat-level thresholds.",
        tags: ["combat"],
        enabledByDefault: true,
        configKey: "combatlevelplugin",
    };

    static config = CombatLevelConfig;

    private readonly client: OsrsClient;
    private readonly configManager = inject(ConfigManager);
    private readonly config = this.configManager.getConfig(CombatLevelConfig);
    private levels: Partial<CombatLevels> = {};
    private combatWidget?: any;
    private combatApplied?: string;
    private nativeCombatText?: string;
    readonly widgetOverlay: WidgetOverlay;

    constructor(client?: OsrsClient) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.widgetOverlay = new CombatLevelOverlay(this);
    }

    protected async startUp(): Promise<void> {
        this.readCurrentBaseLevels();
        this.refresh(true);
    }

    protected async shutDown(): Promise<void> {
        this.restoreCombatText();
        this.levels = {};
    }

    onStatChanged(event: StatChanged): void {
        const i = SKILL_IDS.indexOf(event.getSkill() as typeof SKILL_IDS[number]);
        if (i < 0) return;
        // StatChanged.getLevel() is the real level; boostedLevel is deliberately ignored.
        this.levels[SKILL_KEYS[i]] = event.getLevel();
        this.refresh(true);
    }

    onScriptFinished(scriptId: number): void {
        if (scriptId !== SCRIPT_COMBAT_INTERFACE_SETUP) return;
        this.captureNativeCombatText();
        this.refresh(true);
    }

    onConfigChanged(event: ConfigChanged): void { if (event.getGroup() === CombatLevelConfig.group) this.refresh(true); }

    private refresh(updateCombatLabel: boolean): void {
        if (!this.isStarted()) return;
        const skills = this.completeLevels();
        if (!skills) return;
        const manager = this.client.widgetManager;
        if (!manager) return;

        const combatWidget = manager.getWidgetByUid(COMBAT_LEVEL_UID) as any;
        if (this.combatWidget && this.combatWidget !== combatWidget) this.restoreCombatText();
        if (this.config.showPreciseCombatLevel() && combatWidget && typeof combatWidget.text === "string" && /^Combat Lvl:\s*\d+(?:\.\d+)?$/.test(combatWidget.text)) {
            if (!this.combatWidget) {
                this.combatWidget = combatWidget;
                this.nativeCombatText = combatWidget.text;
            } else if (combatWidget.text !== this.combatApplied) {
                this.nativeCombatText = combatWidget.text;
            }
            if (updateCombatLabel) {
                const text = `Combat Lvl: ${formatPreciseCombatLevel(preciseCombatLevel(skills))}`;
                if (combatWidget.text !== text) {
                    combatWidget.text = text;
                    manager.invalidateWidgetRender(combatWidget);
                }
                this.combatApplied = text;
            }
        } else {
            this.restoreCombatText();
        }

    }

    private restoreCombatText(): void {
        const widget = this.combatWidget;
        if (widget && widget.text === this.combatApplied && this.nativeCombatText) {
            widget.text = this.nativeCombatText;
            this.client.widgetManager?.invalidateWidgetRender(widget);
        }
        this.combatWidget = undefined;
        this.combatApplied = undefined;
        this.nativeCombatText = undefined;
    }

    /** The setup script is authoritative even when its integer text equals our overlay text. */
    private captureNativeCombatText(): void {
        const widget = this.client.widgetManager?.getWidgetByUid(COMBAT_LEVEL_UID) as any;
        if (widget !== this.combatWidget || typeof widget?.text !== "string" || !/^Combat Lvl:\s*\d+(?:\.\d+)?$/.test(widget.text)) return;
        this.nativeCombatText = widget.text;
    }

    private completeLevels(): CombatLevels | undefined {
        if (SKILL_KEYS.some(key => this.levels[key] === undefined)) return undefined;
        return this.levels as CombatLevels;
    }


    getClient(): OsrsClient { return this.client; }

    private readCurrentBaseLevels(): void {
        const read = (this.client as any).cs2Vm?.context?.getStatBase;
        if (typeof read !== "function") return;
        SKILL_IDS.forEach((skill, index) => {
            try {
                const value = Number(read.call((this.client as any).cs2Vm.context, skill));
                if (Number.isFinite(value) && value > 0) this.levels[SKILL_KEYS[index]] = value;
            } catch { /* Stats may not be ready until the login sync arrives. */ }
        });
    }

    getConfig(): typeof this.config { return this.config; }

    getLevels(): CombatLevels | undefined { return this.completeLevels(); }

    /** Exposed to the Combat Options overlay. */
    getCombatLevel(levels: CombatLevels): number {
        return combatLevel(levels);
    }

    getNextLevels(levels: CombatLevels): NextCombatLevels { return nextCombatLevels(levels); }
}
