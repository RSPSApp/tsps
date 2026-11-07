import * as VarClientID from "@runelite/api/gameval/VarClientID";
import * as VarbitID from "@runelite/api/gameval/VarbitID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { WidgetOverlay } from "../ClientPluginManager";
import type { OsrsClient } from "../../OsrsClient";
import { AssistantPanelOverlay } from "../skillassistants/AssistantPanelOverlay";
import { AgilityTrackerConfig } from "./AgilityTrackerConfig";

/** Fallback names from the helper enum (3507) used by the Agility course server plugin. */
const AGILITY_COURSE_ENUM = 3507;
const COURSE_NAMES: Readonly<Record<number, string>> = {
    1: "Gnome Stronghold",
    3: "Draynor Village Rooftops",
    4: "Al Kharid Rooftops",
    6: "Agility Pyramid",
    7: "Varrock Rooftops",
    9: "Barbarian Agility Course",
    10: "Canifis Rooftops",
    11: "Ape Atoll Agility Course",
    12: "Falador Rooftops",
    13: "Wilderness Agility Course",
    14: "Werewolf Agility Course",
    15: "Seers' Village Rooftops",
    17: "Pollnivneach Rooftops",
    18: "Prifddinas Agility Course",
    19: "Rellekka Rooftops",
    20: "Ardougne Rooftops",
    21: "Shayzien Agility Course",
    22: "Colossal Wyrm Agility Course",
};

function varc(client: OsrsClient, id: number): number {
    return client.varManager?.getVarcInt(id) ?? -1;
}

function count(value: number): string {
    return Math.max(0, value).toLocaleString();
}

/** The Agility helper script passes and accumulates XP in tenths. */
function xpFromTenths(value: number): string {
    return (Math.max(0, value) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** RuneLite-style course panel backed by the in-game Agility helper's own lap counters. */
export class AgilityTrackerPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Agility Tracker",
        description: "Track Agility course laps, lap rate, and progress to the next level.",
        tags: ["agility", "skilling", "overlay", "laps"],
        enabledByDefault: false,
        configKey: "agilitytrackerplugin",
    };

    static config = AgilityTrackerConfig;

    private readonly client: OsrsClient;
    private readonly config = inject(ConfigManager).getConfig(AgilityTrackerConfig);
    readonly widgetOverlay: WidgetOverlay;

    constructor(client?: OsrsClient) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.widgetOverlay = new AssistantPanelOverlay(
            "AgilityTrackerOverlay",
            "TOP_LEFT",
            "Agility tracker",
            () => this.rows(),
        );
    }

    private rows(): string[] {
        if (!this.isStarted() || !this.client.isLoggedIn()) return [];
        const vars = this.client.varManager;
        if (!vars) return [];
        const highlightedCourse = vars.getVarbit(VarbitID.HELPER_AGILITY_HIGHLIGHTED_COURSE) | 0;
        const selectedCourse = vars.getVarbit(VarbitID.HELPER_AGILITY_CURRENT_COURSE) | 0;
        const course = highlightedCourse || selectedCourse;
        const laps = varc(this.client, VarClientID.HELPER_AGILITY_LAPS_COMPLETED);
        const lapsPerHour = varc(this.client, VarClientID.HELPER_AGILITY_LAPS_PER_HOUR);
        const lapsUntilLevel = varc(this.client, VarClientID.HELPER_AGILITY_LAPS_UNTIL_LEVEL);
        const xpGained = varc(this.client, VarClientID.HELPER_AGILITY_XP_GAINED);
        if (course <= 0 && laps <= 0 && xpGained <= 0) return [];

        const courseName = this.courseName(course);
        const rows = [courseName ?? (course > 0 ? `Course ${course}` : "Course session")];
        if (laps >= 0) rows.push(`Laps completed: ${count(laps)}`);
        if (this.config.showLapsPerHour() && lapsPerHour >= 0) {
            rows.push(`Lap rate: ${count(lapsPerHour)} per hour`);
        }
        if (this.config.showLapsUntilLevel() && lapsUntilLevel >= 0) {
            rows.push(`Laps to next level: ${count(lapsUntilLevel)}`);
        }
        if (this.config.showXpGained() && xpGained >= 0) rows.push(`XP gained: ${xpFromTenths(xpGained)}`);
        return rows;
    }

    private courseName(course: number): string | undefined {
        if (course <= 0) return undefined;
        const enumType = this.client.loaderFactory?.getEnumTypeLoader()?.load(AGILITY_COURSE_ENUM);
        const enumIndex = enumType?.keys?.indexOf(course) ?? -1;
        return (enumIndex >= 0 ? enumType?.stringValues?.[enumIndex] : undefined) ?? COURSE_NAMES[course];
    }
}
