import { GameState } from "@runelite/api/GameState";
import type { GameStateChanged, StatChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { SkillId, SKILL_NAME } from "../../../rs/skill/skills";
import type { WidgetOverlay } from "../ClientPluginManager";
import type { OsrsClient } from "../../OsrsClient";
import { AssistantPanelOverlay } from "../skillassistants/AssistantPanelOverlay";
import { GatheringTrackerConfig } from "./GatheringTrackerConfig";

const GATHERING_SKILLS = [SkillId.Mining, SkillId.Woodcutting, SkillId.Fishing] as const;

type GatheringSession = {
    xpGained: number;
    xpDrops: number;
};

function formatXp(xp: number): string {
    return Math.floor(xp).toLocaleString();
}

/** Per-session XP-award summaries for Mining, Woodcutting, and Fishing. */
export class GatheringTrackerPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Gathering Tracker",
        description: "Track Mining, Woodcutting, and Fishing XP awards in the current session.",
        tags: ["mining", "woodcutting", "fishing", "skilling", "overlay"],
        enabledByDefault: false,
        configKey: "gatheringtrackerplugin",
    };

    static config = GatheringTrackerConfig;

    private readonly client: OsrsClient;
    private readonly config = inject(ConfigManager).getConfig(GatheringTrackerConfig);
    private readonly lastXp = new Map<SkillId, number>();
    private readonly sessions = new Map<SkillId, GatheringSession>();
    readonly widgetOverlay: WidgetOverlay;

    constructor(client?: OsrsClient) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.widgetOverlay = new AssistantPanelOverlay(
            "GatheringTrackerOverlay",
            "TOP_RIGHT",
            "Gathering tracker",
            () => this.rows(),
        );
    }

    protected async startUp(): Promise<void> {
        this.resetSession();
        this.seedXpBaselines();
    }

    protected async shutDown(): Promise<void> {
        this.resetSession();
    }

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        if (state === GameState.LOGGING_IN || state === GameState.HOPPING) this.resetSession();
    }

    onStatChanged(event: StatChanged): void {
        const skill = event.getSkill();
        if (!GATHERING_SKILLS.includes(skill as typeof GATHERING_SKILLS[number])) return;
        const xp = event.getXp();
        const previous = this.lastXp.get(skill);
        this.lastXp.set(skill, xp);
        if (previous === undefined || xp <= previous) {
            if (previous !== undefined && xp < previous) this.sessions.delete(skill);
            return;
        }

        const session = this.sessions.get(skill) ?? { xpGained: 0, xpDrops: 0 };
        session.xpGained += xp - previous;
        session.xpDrops++;
        this.sessions.set(skill, session);
    }

    private rows(): string[] {
        if (!this.isStarted() || !this.client.isLoggedIn()) return [];
        return GATHERING_SKILLS.flatMap((skill) => {
            const session = this.sessions.get(skill);
            if (!session || session.xpGained <= 0) return [];
            const parts = [`${SKILL_NAME[skill]}: +${formatXp(session.xpGained)} XP`];
            if (this.config.showXpDrops()) parts.push(`${session.xpDrops} drops`);
            if (this.config.showAverageXp() && session.xpDrops > 0) {
                parts.push(`${formatXp(session.xpGained / session.xpDrops)}/drop`);
            }
            return [parts.join(" · ")];
        });
    }

    private resetSession(): void {
        this.lastXp.clear();
        this.sessions.clear();
    }

    private seedXpBaselines(): void {
        const getStatXp = this.client.cs2Vm?.context?.getStatXp;
        if (!getStatXp) return;

        for (const skill of GATHERING_SKILLS) {
            const xp = getStatXp(skill);
            if (Number.isFinite(xp) && xp >= 0) this.lastXp.set(skill, xp);
        }
    }
}
