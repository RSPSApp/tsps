import { GameState } from "@runelite/api/GameState";
import type { ConfigChanged, GameStateChanged, StatChanged } from "@runelite/api/events";
import { STATS } from "@runelite/api/gameval/InterfaceID";
import * as VarPlayerID from "@runelite/api/gameval/VarPlayerID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { toRuneLiteGameState } from "../../../runelite/impl/GameStateMapping";
import { MenuTargetType } from "../../../rs/MenuEntry";
import { MAX_REAL_LEVEL, SKILL_IDS, SKILL_NAME, SkillId } from "../../../rs/skill/skills";
import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import type { MenuTransformContext } from "../../../ui/menu/menuTransforms";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetOverlay } from "../ClientPluginManager";
import { XpInfoBoxOverlay } from "./XpInfoBoxOverlay";
import { createXpTrackerNavigationButton } from "./XpPanel";
import { XpTrackerConfig } from "./XpTrackerConfig";
import { XpPauseState, XpState, type XpSave, type XpSnapshotSingle } from "./xpState";

export const MENUOP_ADD_CANVAS_TRACKER = "Add to canvas";
export const MENUOP_REMOVE_CANVAS_TRACKER = "Remove from canvas";

/** Ticks after logging in (or hopping) during which the login stat sync is not counted. */
const INITIALIZE_TRACKER_TICKS = 2;
const SAVE_INTERVAL_MS = 60_000;
const TICK_INTERVAL_MS = 1_000;

/** One tracked skill as the side panel shows it. */
export type XpSkillView = {
    skill: SkillId;
    snapshot: XpSnapshotSingle;
    paused: boolean;
    compact: boolean;
    hasOverlay: boolean;
};

/** Everything the side panel draws; a new object whenever any of it changes. */
export type XpPanelView = {
    overall: { gained: number; perHour: number };
    skills: XpSkillView[];
};

/**
 * RuneLite 1.13.3 XP Tracker. Tracks experience gained per skill and in total since login (or
 * since it was saved): rates, actions, time to the next level or XP-drop goal, with pause and
 * reset, a side panel of info boxes and optional canvas boxes per skill.
 *
 * Not ported: the Wise Old Man link and the RuneLite XP API submit (online services), and the
 * reset on a change of world type (no runtime world type in this client).
 */
export class XpTrackerPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "XP Tracker",
        description: "Enable the XP Tracker panel",
        tags: ["experience", "levels", "panel"],
        enabledByDefault: false,
        configKey: "xptrackerplugin",
    };

    static config = XpTrackerConfig;

    private readonly configManager = inject(ConfigManager);
    readonly config = this.configManager.getConfig(XpTrackerConfig);
    private readonly toolbar: ClientToolbar | undefined;
    private readonly osrsClient: OsrsClient;
    /** Overridable wall clock (RuneLite's System.currentTimeMillis). */
    now: () => number = () => Date.now();

    readonly xpState = new XpState();
    private pauseState = new XpPauseState();
    /** The latest experience the server sent, per skill (RuneLite's client.getSkillExperience). */
    private readonly experience = new Map<SkillId, number>();
    private readonly overlays = new Map<SkillId, XpInfoBoxOverlay>();
    private initializeTracker = 0;
    private lastAccount: string | undefined;
    private lastTickMillis = 0;
    private navButton?: NavigationButton;
    private timers: ReturnType<typeof setInterval>[] = [];
    private readonly listeners = new Set<() => void>();
    private view?: XpPanelView;
    private readonly onPageHide = () => this.saveState();

    constructor(osrsClient?: OsrsClient) {
        super();
        this.osrsClient = osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN);
        try {
            this.toolbar = inject(ClientToolbar);
        } catch {
            this.toolbar = undefined;
        }
    }

    protected async startUp(): Promise<void> {
        this.initializeTracker = INITIALIZE_TRACKER_TICKS;
        this.lastAccount = undefined;
        this.lastTickMillis = 0;
        this.pauseState = new XpPauseState();
        if (this.toolbar) {
            this.navButton = createXpTrackerNavigationButton(this);
            this.toolbar.addNavigation(this.navButton);
        }
        this.timers = [
            setInterval(() => this.tickSkillTimes(), TICK_INTERVAL_MS),
            setInterval(() => this.saveState(), SAVE_INTERVAL_MS),
        ];
        for (const timer of this.timers) (timer as any)?.unref?.();
        if (typeof window !== "undefined") window.addEventListener("pagehide", this.onPageHide);
    }

    protected async shutDown(): Promise<void> {
        this.saveState();
        for (const timer of this.timers) clearInterval(timer);
        this.timers = [];
        if (typeof window !== "undefined") window.removeEventListener("pagehide", this.onPageHide);
        if (this.navButton) this.toolbar?.removeNavigation(this.navButton);
        this.navButton = undefined;
        this.overlays.clear();
        this.xpState.reset();
        this.emit();
    }

    // ------------------------------------------------------------------ events

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        if (state === GameState.LOGGING_IN || state === GameState.HOPPING) {
            this.initializeTracker = INITIALIZE_TRACKER_TICKS;
            // The next account's stats arrive with its login; never mix them with these.
            if (state === GameState.LOGGING_IN) this.experience.clear();
        }
    }

    onStatChanged(event: StatChanged): void {
        const skill = event.getSkill();
        if (!SKILL_IDS.includes(skill)) return;
        this.experience.set(skill, event.getXp());
        if (this.initializeTracker > 0 || !this.isStarted()) return;

        if (this.config.hideMaxed() && event.getLevel() >= MAX_REAL_LEVEL) {
            this.hideSkill(skill);
            this.emit();
            return;
        }
        const [goalStart, goalEnd] = this.goals(skill);
        this.xpState.updateSkill(skill, event.getXp(), goalStart, goalEnd, this.now(),
            this.config.prioritizeRecentXpSkills());
        const overall = this.overallExperience();
        if (overall !== undefined) {
            if (this.xpState.isOverallInitialized()) this.xpState.updateOverall(overall, this.now());
            else this.xpState.initializeOverall(overall);
        }
        this.emit();
    }

    onGameTick(): void {
        if (this.initializeTracker <= 0 || --this.initializeTracker > 0) return;
        this.initializeAfterLogin();
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === XpTrackerConfig.group) this.emit();
    }

    /** The second tick after login: account check, restore, offline gains, baselines. */
    private initializeAfterLogin(): void {
        const account = this.account();
        if (account !== this.lastAccount) {
            if (this.lastAccount !== undefined) this.saveState(this.lastAccount);
            this.lastAccount = account;
            this.resetState();
        }

        const save = !this.xpState.isOverallInitialized() && this.config.saveState();
        if (save) {
            const save = this.loadSave();
            if (save) this.xpState.restore(save);
        }

        // Experience gained while logged out is not part of the session; less means a
        // different account or a reset, and the trackers start over.
        for (const skill of SKILL_IDS) {
            const state = this.xpState.get(skill);
            const xp = this.experience.get(skill);
            if (!state || state.startXp === -1 || xp === undefined) continue;
            if (xp < state.currentXp) {
                this.resetState();
                this.clearSave();
                break;
            }
            state.startXp += xp - state.currentXp;
        }
        if (save) {
            for (const skill of this.xpState.order) {
                const xp = this.experience.get(skill);
                const state = this.xpState.get(skill);
                if (xp !== undefined && state) state.updateGoals(state.currentXp, ...this.goals(skill));
            }
        }
        const overall = this.overallExperience();
        const total = this.xpState.overall;
        if (this.xpState.isOverallInitialized() && overall !== undefined && overall >= total.currentXp) {
            total.startXp += overall - total.currentXp;
        }

        for (const skill of SKILL_IDS) {
            const xp = this.experience.get(skill);
            if (xp !== undefined && !this.xpState.isInitialized(skill)) {
                this.xpState.updateSkill(skill, xp, -1, -1, this.now(), false);
            }
        }
        if (!this.xpState.isOverallInitialized() && overall !== undefined) {
            this.xpState.initializeOverall(overall);
        }
        this.emit();
    }

    /** Every second: pauses (timeout, logout), tracked time and auto reset (RuneLite's @Schedule). */
    tickSkillTimes(): void {
        if (!this.isStarted()) return;
        const now = this.now();
        const pauseAfter = Number(this.config.pauseSkillAfter()) || 0;
        for (const skill of SKILL_IDS) {
            const xp = this.experience.get(skill);
            if (xp !== undefined) this.pauseState.tickXp(skill, xp, pauseAfter, now);
        }
        const overall = this.overallExperience();
        if (overall !== undefined) this.pauseState.tickOverallXp(overall, pauseAfter, now);

        this.pauseState.tickLogout(this.config.logoutPausing() !== false, this.gameState() >= GameState.LOADING);

        if (this.lastTickMillis === 0) {
            this.lastTickMillis = now;
            return;
        }
        const delta = now - this.lastTickMillis;
        this.lastTickMillis = now;
        const resetAfter = Number(this.config.resetSkillRateAfter()) || 0;
        for (const skill of SKILL_IDS) {
            if (!this.pauseState.isPaused(skill)) this.xpState.tick(skill, delta, now, resetAfter);
        }
        if (!this.pauseState.isOverallPaused()) this.xpState.tickOverall(delta);
        this.emit();
    }

    // ------------------------------------------------------------------ actions

    /** "Reset": the skill starts over from its current experience; its box and overlay go. */
    resetSkillState(skill: SkillId): void {
        const xp = this.experience.get(skill);
        if (xp === undefined) return;
        this.xpState.resetSkill(skill, xp);
        this.xpState.get(skill)!.updateGoals(xp, ...this.goals(skill));
        this.overlays.delete(skill);
        this.emit();
    }

    resetOtherSkillState(skill: SkillId): void {
        for (const other of SKILL_IDS) if (other !== skill) this.resetSkillState(other);
    }

    /** "Reset All": every tracker and the saved state. */
    resetAndInitState(): void {
        this.clearSave();
        this.resetState();
        for (const skill of SKILL_IDS) {
            const xp = this.experience.get(skill);
            if (xp !== undefined) this.xpState.updateSkill(skill, xp, ...this.goals(skill), this.now(), false);
        }
        const overall = this.overallExperience();
        if (overall !== undefined) this.xpState.initializeOverall(overall);
        this.emit();
    }

    resetSkillPerHour(skill: SkillId): void {
        this.xpState.get(skill)?.resetPerHour(this.now());
        this.emit();
    }

    resetAllSkillsPerHour(): void {
        const now = this.now();
        for (const skill of SKILL_IDS) this.xpState.get(skill)?.resetPerHour(now);
        this.xpState.overall.resetPerHour(now);
        this.emit();
    }

    pauseSkill(skill: SkillId, pause: boolean): void {
        if (pause) this.pauseState.pauseSkill(skill);
        else this.pauseState.unpauseSkill(skill, this.now());
        this.emit();
    }

    pauseAllSkills(pause: boolean): void {
        for (const skill of SKILL_IDS) {
            if (pause) this.pauseState.pauseSkill(skill);
            else this.pauseState.unpauseSkill(skill, this.now());
        }
        if (pause) this.pauseState.pauseOverall();
        else this.pauseState.unpauseOverall(this.now());
        this.emit();
    }

    isPaused(skill: SkillId): boolean {
        return this.pauseState.isPaused(skill);
    }

    toggleCompactView(skill: SkillId): void {
        if (this.xpState.compactView.has(skill)) this.xpState.compactView.delete(skill);
        else this.xpState.compactView.add(skill);
        this.emit();
    }

    /** Drag-and-drop in the side panel. */
    setOrder(order: SkillId[]): void {
        this.xpState.order = order.filter((s) => this.xpState.order.includes(s));
        this.emit();
    }

    hasOverlay(skill: SkillId): boolean {
        return this.overlays.has(skill);
    }

    addOverlay(skill: SkillId): void {
        if (!this.overlays.has(skill)) this.overlays.set(skill, new XpInfoBoxOverlay(this, skill));
        this.emit();
    }

    removeOverlay(skill: SkillId): void {
        this.overlays.delete(skill);
        this.emit();
    }

    widgetOverlays(): WidgetOverlay[] {
        if (!this.isStarted() || this.gameState() !== GameState.LOGGED_IN) return [];
        return [...this.overlays.values()];
    }

    // ------------------------------------------------------------------ XpTrackerService

    /** RuneLite's XpTrackerService.getStartGoalXp: where the skill's progress bar starts. */
    getStartGoalXp(skill: SkillId): number {
        return this.getSkillSnapshot(skill)?.startGoalXp ?? 0;
    }

    /** RuneLite's XpTrackerService.getEndGoalXp: the skill's goal (next level, XP-drop goal, 200M). */
    getEndGoalXp(skill: SkillId): number {
        return this.getSkillSnapshot(skill)?.endGoalXp ?? 0;
    }

    /** RuneLite's getActionsLeft; Integer.MAX_VALUE (2147483647) when unknown. */
    getActionsLeft(skill: SkillId): number {
        return this.getSkillSnapshot(skill)?.actionsRemainingToGoal ?? 2147483647;
    }

    getXpHr(skill: SkillId): number {
        return this.getSkillSnapshot(skill)?.xpPerHour ?? 0;
    }

    /** RuneLite's getTimeTilGoal: the SHORT time-to-goal text. */
    getTimeTilGoal(skill: SkillId): string {
        return this.getSkillSnapshot(skill)?.timeTillGoalShort ?? "∞";
    }

    /** The snapshot a canvas box or info box draws; undefined for a skill not tracked. */
    getSkillSnapshot(skill: SkillId): XpSnapshotSingle | undefined {
        const state = this.xpState.get(skill);
        return state && state.startXp !== -1 ? state.snapshot() : undefined;
    }

    // ------------------------------------------------------------------ skill tab menu

    /** RuneLite's onMenuEntryAdded for the Stats tab: "Add to canvas"/"Remove from canvas". */
    transformMenuEntries(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[] {
        if (!this.isStarted() || context.surface !== "widget" || !context.menu) return entries;
        if (context.widgetId >>> 16 !== STATS || !this.config.skillTabOverlayMenuOptions()) return entries;
        const index = entries.findIndex((e) => String(e.option).startsWith("View"));
        if (index < 0) return entries;
        const view = entries[index];
        // "View <col=ff981f>Attack</col> guide", or the skill as the entry's target.
        const skillText = String(view.option).split(" ")[1] || String(view.target ?? "");
        const skill = skillFromName(stripTags(skillText) || stripTags(String(view.target ?? "")));
        if (skill === undefined) return entries;
        const out = entries.slice();
        out.splice(index + 1, 0, {
            option: this.hasOverlay(skill) ? MENUOP_REMOVE_CANVAS_TRACKER : MENUOP_ADD_CANVAS_TRACKER,
            target: skillText.includes("<col") ? skillText : `<col=ff981f>${SKILL_NAME[skill]}</col>`,
            targetType: MenuTargetType.NONE,
            onClick: () => (this.hasOverlay(skill) ? this.removeOverlay(skill) : this.addOverlay(skill)),
        });
        return out;
    }

    // ------------------------------------------------------------------ panel store

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getView(): XpPanelView {
        if (!this.view) {
            const overall = this.xpState.overall;
            this.view = {
                overall: {
                    gained: overall.startXp === -1 ? 0 : overall.totalXpGained,
                    perHour: overall.startXp === -1 ? 0 : overall.xpPerHour,
                },
                skills: this.xpState.order.flatMap((skill) => {
                    const snapshot = this.getSkillSnapshot(skill);
                    return snapshot ? [{
                        skill,
                        snapshot,
                        paused: this.pauseState.isPaused(skill),
                        compact: this.xpState.compactView.has(skill),
                        hasOverlay: this.overlays.has(skill),
                    }] : [];
                }),
            };
        }
        return this.view;
    }

    getClient(): OsrsClient {
        return this.osrsClient;
    }

    private emit(): void {
        this.view = undefined;
        for (const listener of this.listeners) listener();
    }

    // ------------------------------------------------------------------ helpers

    private gameState(): GameState {
        return toRuneLiteGameState((this.osrsClient as any)?.gameState);
    }

    private hideSkill(skill: SkillId): void {
        this.xpState.order = this.xpState.order.filter((s) => s !== skill);
        this.overlays.delete(skill);
    }

    private resetState(): void {
        this.xpState.reset();
        this.overlays.clear();
    }

    /** The in-game XP-drop goal for the skill (start, end), or -1 when unset. */
    private goals(skill: SkillId): [number, number] {
        const name = SkillId[skill].toUpperCase();
        const start = (VarPlayerID as Record<string, number>)[`XPDROPS_${name}_START`];
        const end = (VarPlayerID as Record<string, number>)[`XPDROPS_${name}_END`];
        const vars: any = (this.osrsClient as any)?.varManager;
        if (start === undefined || end === undefined || typeof vars?.getVarp !== "function") return [-1, -1];
        return [vars.getVarp(start) | 0, vars.getVarp(end) | 0];
    }

    /** Total experience (RuneLite's getOverallExperience), once every skill's is known. */
    private overallExperience(): number | undefined {
        let total = 0;
        for (const skill of SKILL_IDS) {
            const xp = this.experience.get(skill);
            if (xp === undefined) return undefined;
            total += xp;
        }
        return total;
    }

    /** The account the trackers belong to: RuneLite's RS profile. */
    private account(): string {
        const client: any = this.osrsClient;
        return String(client?.localPlayerName || client?.loginState?.username || "").trim().toLowerCase();
    }

    private saveKey(account: string): string {
        return `rsprofile.${account}.state`;
    }

    /** Saved every minute and on shutdown, whatever "Save between sessions" says (as RuneLite). */
    saveState(account: string | undefined = this.lastAccount): void {
        if (!account) return;
        const save = this.xpState.save();
        if (!save) return;
        this.configManager.setConfiguration(XpTrackerConfig.group, this.saveKey(account), JSON.stringify(save));
    }

    private loadSave(): XpSave | undefined {
        if (!this.lastAccount) return undefined;
        const raw = this.configManager.getConfiguration(XpTrackerConfig.group, this.saveKey(this.lastAccount));
        if (!raw) return undefined;
        try {
            return JSON.parse(raw) as XpSave;
        } catch {
            return undefined;
        }
    }

    private clearSave(): void {
        if (this.lastAccount) {
            this.configManager.unsetConfiguration(XpTrackerConfig.group, this.saveKey(this.lastAccount));
        }
    }
}

function stripTags(text: string): string {
    return text.replace(/<[^>]*>/g, "").trim();
}

function skillFromName(name: string): SkillId | undefined {
    const lower = name.toLowerCase();
    return SKILL_IDS.find((id) => SKILL_NAME[id].toLowerCase() === lower);
}
