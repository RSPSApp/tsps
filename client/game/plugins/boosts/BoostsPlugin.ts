import type { Client } from "@runelite/api/Client";
import { GameState } from "@runelite/api/GameState";
import type { ConfigChanged, GameStateChanged, GameTick, StatChanged } from "@runelite/api/events";
import * as VarbitID from "@runelite/api/gameval/VarbitID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Notifier } from "@runelite/client/Notifier";
import { openConfiguration } from "@runelite/client/plugins/config/configurationRequests";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import { SKILL_IDS, SKILL_NAME, SkillId } from "../../../rs/skill/skills";
import type { OsrsClient } from "../../OsrsClient";
import { BoostsConfig, DisplayBoosts, DisplayChangeMode } from "./BoostsConfig";
import { BoostsInfoBoxOverlay, BoostsPanelOverlay, CompactBoostsOverlay } from "./BoostsOverlay";

/** RuneLite's Constants.GAME_TICK_LENGTH. */
const GAME_TICK_LENGTH = 600;

const BOOSTABLE_COMBAT_SKILLS: ReadonlySet<SkillId> = new Set([
    SkillId.Attack, SkillId.Strength, SkillId.Defence, SkillId.Ranged, SkillId.Magic,
]);

const BOOSTABLE_NON_COMBAT_SKILLS: ReadonlySet<SkillId> = new Set([
    SkillId.Mining, SkillId.Agility, SkillId.Smithing, SkillId.Herblore, SkillId.Fishing, SkillId.Thieving,
    SkillId.Cooking, SkillId.Crafting, SkillId.Firemaking, SkillId.Fletching, SkillId.Woodcutting, SkillId.Runecraft,
    SkillId.Slayer, SkillId.Farming, SkillId.Construction, SkillId.Hunter, SkillId.Sailing,
]);

type NotifyClient = { notify(message: string): void };

/**
 * RuneLite 1.13.5 Boosts Information: boosted and drained levels as infoboxes, a panel or a
 * compact list, with the time to the next stat restore, and a notification when a boost drains
 * to the threshold.
 */
export class BoostsPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Boosts Information",
        description: "Show combat and/or skill boost information",
        tags: ["combat", "notifications", "skilling", "overlay"],
        configKey: "boostsplugin",
    };

    static config = BoostsConfig;

    readonly config = inject(ConfigManager).getConfig(BoostsConfig);
    private readonly client: Client;
    private readonly notifier: NotifyClient;
    readonly infoBoxOverlay = new BoostsInfoBoxOverlay(this);
    readonly panelOverlay = new BoostsPanelOverlay(this);
    readonly compactOverlay = new CompactBoostsOverlay(this);
    /** Overridable wall clock. */
    now: () => number = () => Date.now();

    /** Skills shown and currently boosted or drained, in skill order. */
    readonly skillsToDisplay = new Set<SkillId>();
    private readonly shownSkills = new Set<SkillId>();
    private isChangedDown = false;
    private isChangedUp = false;
    private readonly lastSkillLevels = new Array<number>(SKILL_IDS.length).fill(-1);
    /** Levels from StatChanged, which can be ahead of the client's own skill table. */
    private readonly boostedLevels = new Map<SkillId, number>();
    private readonly realLevels = new Map<SkillId, number>();
    private lastChangeDown = -1;
    private lastChangeUp = -1;
    private preserveBeenActive = false;
    private lastTickMillis = 0;

    constructor(client?: Client, notifier?: NotifyClient) {
        super();
        let osrsClient: OsrsClient | undefined;
        if (client) {
            this.client = client;
        } else {
            osrsClient = inject<OsrsClient>(CLIENT_TOKEN);
            this.client = new ClientImpl(osrsClient);
        }
        this.notifier = notifier ?? new Notifier(osrsClient!);
    }

    protected async startUp(): Promise<void> {
        this.updateShownSkills();
        this.lastSkillLevels.fill(-1);
    }

    protected async shutDown(): Promise<void> {
        this.preserveBeenActive = false;
        this.lastChangeDown = -1;
        this.lastChangeUp = -1;
        this.isChangedUp = false;
        this.isChangedDown = false;
        this.skillsToDisplay.clear();
    }

    widgetOverlays() {
        return [this.infoBoxOverlay, this.panelOverlay, this.compactOverlay];
    }

    onGameStateChanged(event: GameStateChanged): void {
        switch (event.getGameState()) {
            case GameState.LOGIN_SCREEN:
            case GameState.HOPPING:
                // After world hop and log out timers are in undefined state so just reset
                this.lastChangeDown = -1;
                this.lastChangeUp = -1;
        }
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== BoostsConfig.group) return;
        this.updateShownSkills();
        if (this.config.displayNextBuffChange() === DisplayChangeMode.NEVER) this.lastChangeDown = -1;
        if (this.config.displayNextDebuffChange() === DisplayChangeMode.NEVER) this.lastChangeUp = -1;
    }

    onStatChanged(statChanged: StatChanged): void {
        const skill = statChanged.getSkill();
        this.boostedLevels.set(skill, statChanged.getBoostedLevel());
        this.realLevels.set(skill, statChanged.getLevel());
        if (!BOOSTABLE_COMBAT_SKILLS.has(skill) && !BOOSTABLE_NON_COMBAT_SKILLS.has(skill)) return;

        const last = this.lastSkillLevels[skill];
        const cur = this.getBoostedSkillLevel(skill);
        if (cur === last - 1) {
            // Stat was restored down (from buff)
            this.lastChangeDown = this.client.getTickCount();
        }
        if (cur === last + 1) {
            // Stat was restored up (from debuff)
            this.lastChangeUp = this.client.getTickCount();
        }
        this.lastSkillLevels[skill] = cur;
        this.updateBoostedStats();

        const boostThreshold = Number(this.config.boostThreshold()) || 0;
        const real = this.getRealSkillLevel(skill);
        const lastBoost = last - real;
        const boost = cur - real;
        if (boost <= boostThreshold && boostThreshold < lastBoost && this.config.notifyOnBoost() === true) {
            this.notifier.notify(`${SKILL_NAME[skill]} level is getting low!`);
        }
    }

    onGameTick(_event?: GameTick): void {
        this.lastTickMillis = this.now();
        if (this.getChangeUpTicks() <= 0) {
            switch (this.config.displayNextDebuffChange()) {
                case DisplayChangeMode.ALWAYS:
                    if (this.lastChangeUp !== -1) this.lastChangeUp = this.client.getTickCount();
                    break;
                default:
                    this.lastChangeUp = -1;
            }
        }
        if (this.getChangeDownTicks() <= 0) {
            switch (this.config.displayNextBuffChange()) {
                case DisplayChangeMode.ALWAYS:
                    if (this.lastChangeDown !== -1) this.lastChangeDown = this.client.getTickCount();
                    break;
                default:
                    this.lastChangeDown = -1;
            }
        }
    }

    getBoostedSkillLevel(skill: SkillId): number {
        return this.boostedLevels.get(skill) ?? this.client.getBoostedSkillLevel(skill);
    }

    getRealSkillLevel(skill: SkillId): number {
        return this.realLevels.get(skill) ?? this.client.getRealSkillLevel(skill);
    }

    private updateShownSkills(): void {
        const mode = this.config.displayBoosts();
        const combat = mode === DisplayBoosts.COMBAT || mode === DisplayBoosts.BOTH;
        const nonCombat = mode === DisplayBoosts.NON_COMBAT || mode === DisplayBoosts.BOTH;
        for (const skill of BOOSTABLE_COMBAT_SKILLS) {
            if (combat) this.shownSkills.add(skill); else this.shownSkills.delete(skill);
        }
        for (const skill of BOOSTABLE_NON_COMBAT_SKILLS) {
            if (nonCombat) this.shownSkills.add(skill); else this.shownSkills.delete(skill);
        }
        this.updateBoostedStats();
    }

    private updateBoostedStats(): void {
        // Reset is boosted
        this.isChangedDown = false;
        this.isChangedUp = false;
        this.skillsToDisplay.clear();
        // Check if we are still boosted
        for (const skill of SKILL_IDS) {
            if (!this.shownSkills.has(skill)) continue;
            const boosted = this.getBoostedSkillLevel(skill);
            const base = this.getRealSkillLevel(skill);
            if (boosted > base) this.isChangedUp = true;
            else if (boosted < base) this.isChangedDown = true;
            if (boosted !== base) this.skillsToDisplay.add(skill);
        }
    }

    getChangeDownTicks(): number {
        const mode = this.config.displayNextBuffChange();
        if (this.lastChangeDown === -1 || mode === DisplayChangeMode.NEVER
            || (mode === DisplayChangeMode.BOOSTED && !this.isChangedUp)) {
            return -1;
        }
        const ticksSinceChange = this.client.getTickCount() - this.lastChangeDown;
        const isPreserveActive = this.client.getVarbitValue(VarbitID.PRAYER_PRESERVE) === 1;
        if ((isPreserveActive && (ticksSinceChange < 75 || this.preserveBeenActive)) || ticksSinceChange > 125) {
            this.preserveBeenActive = true;
            return 150 - ticksSinceChange;
        }
        this.preserveBeenActive = false;
        return ticksSinceChange > 100 ? 125 - ticksSinceChange : 100 - ticksSinceChange;
    }

    getChangeUpTicks(): number {
        const mode = this.config.displayNextDebuffChange();
        if (this.lastChangeUp === -1 || mode === DisplayChangeMode.NEVER
            || (mode === DisplayChangeMode.BOOSTED && !this.isChangedDown)) {
            return -1;
        }
        return 100 - (this.client.getTickCount() - this.lastChangeUp);
    }

    /** Ticks to whole seconds, less the time since the last tick. */
    getChangeTime(time: number): number {
        const diff = this.now() - this.lastTickMillis;
        return time !== -1 ? Math.trunc((time * GAME_TICK_LENGTH - diff) / 1000) : time;
    }

    /** The text colour for a boost (RuneLite's getTextColor), 0xRRGGBB. */
    textColor(boost: number): number {
        if (boost < 0) return 0xee3333;
        return boost <= (Number(this.config.boostThreshold()) || 0) ? 0xffff00 : 0x00ff00;
    }

    /** The infobox and compact text: the boosted level, or "+n" / "-n". */
    boostText(skill: SkillId): string {
        const boosted = this.getBoostedSkillLevel(skill);
        if (this.config.useRelativeBoost() !== true) return String(boosted);
        const boost = boosted - this.getRealSkillLevel(skill);
        return boost > 0 ? `+${boost}` : String(boost);
    }

    openSettings(): void {
        openConfiguration(BoostsPlugin);
    }
}
