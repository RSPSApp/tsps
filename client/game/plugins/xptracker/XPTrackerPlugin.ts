import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import type { OsrsClient } from "../../OsrsClient";
import { GameState } from "../../login/GameState";
import { SKILL_COUNT, SKILL_NAME, type SkillId } from "../../../rs/skill/skills";
import { createXPTrackerNavigationButton } from "./XPTrackerPanel";

export const XPTrackerConfig = ConfigGroup("xptracker", {
    resetOnLogout: ConfigItem({ name: "Reset on logout", description: "Otherwise keep this account's session through relogs and exclude offline time. Account changes always reset.", default: false }),
});
export type XPRow = { skill: number; name: string; gained: number; perHour: number };
type SkillSession = { current: number; gained: number; since: number };

/** Session uses a pausable active clock. XP received with a login snapshot is a baseline, never a gain. */
export class XPSession {
    private account = "";
    private skills = new Map<number, SkillSession>();
    private pausedAt?: number;
    private offlineMs = 0;
    private clock(now: number): number { return (this.pausedAt ?? now) - this.offlineMs; }
    update(account: string, values: readonly number[], now: number, rebase = false): void {
        const normalized = account.trim().toLowerCase();
        if (normalized !== this.account) { this.clear(); this.account = normalized; }
        const clock = this.clock(now);
        values.forEach((xp, skill) => {
            if (!Number.isFinite(xp) || xp < 0) return;
            const previous = this.skills.get(skill);
            if (!previous || xp < previous.current) { this.skills.set(skill, { current: xp, gained: 0, since: clock }); return; }
            if (!rebase) previous.gained += xp - previous.current;
            previous.current = xp;
        });
    }
    pause(now: number): void { this.pausedAt ??= now; }
    resume(now: number): void { if (this.pausedAt !== undefined) { this.offlineMs += Math.max(0, now - this.pausedAt); this.pausedAt = undefined; } }
    rows(now: number): XPRow[] {
        return [...this.skills.entries()].filter(([, value]) => value.gained > 0).map(([skill, value]) => ({
            skill, name: SKILL_NAME[skill as SkillId] ?? `Skill ${skill}`, gained: value.gained,
            perHour: Math.round(value.gained * 3600000 / Math.max(60000, this.clock(now) - value.since)),
        }));
    }
    reset(skill: number | undefined, now: number): void {
        for (const [id, value] of this.skills) if (skill === undefined || skill === id) { value.gained = 0; value.since = this.clock(now); }
    }
    clear(): void { this.skills.clear(); this.account = ""; this.pausedAt = undefined; this.offlineMs = 0; }
}

export class XPTrackerPlugin extends Plugin {
    static descriptor = { name: "XP Tracker", description: "Track session experience and XP per hour for each skill.", tags: ["skills", "experience"], configKey: "xptrackerplugin", enabledByDefault: false };
    static config = XPTrackerConfig;
    private readonly config = inject(ConfigManager).getConfig(XPTrackerConfig);
    private readonly toolbar = inject(ClientToolbar);
    private readonly client: OsrsClient;
    private readonly session = new XPSession();
    private readonly listeners = new Set<() => void>();
    private nav?: NavigationButton;
    private connected = false;
    private state: { rows: XPRow[]; connected: boolean } = { rows: [], connected: false };
    constructor(client?: OsrsClient, private readonly now: () => number = () => performance.now()) { super(); this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN); }
    getState() { return this.state; }
    subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    reset(skill?: number): void { this.session.reset(skill, this.now()); this.commit(); }
    private commit(): void { this.state = { rows: this.session.rows(this.now()), connected: this.connected }; for (const listener of this.listeners) listener(); }
    protected override async startUp(): Promise<void> {
        this.nav = createXPTrackerNavigationButton(this); this.toolbar.addNavigation(this.nav); this.onGameTick();
    }
    protected override async shutDown(): Promise<void> {
        if (this.nav) this.toolbar.removeNavigation(this.nav);
        this.nav = undefined; this.connected = false; this.session.clear(); this.commit();
    }
    onGameStateChanged(): void {
        // LOGGED_IN precedes the skill snapshot. Establish its baseline on the first ordered tick.
        if (this.client.gameState !== 30) this.onGameTick();
    }
    onGameTick(): void {
        if (!this.isStarted()) return;
        const now = this.now();
        // A scene load is still online time. Preserve whether we had a live baseline:
        // a normal region change must count its XP, but loading after login/reconnect
        // must still rebase the first ordered snapshot.
        if (this.client.gameState === GameState.LOADING_GAME) { this.commit(); return; }
        if (this.client.gameState !== 30 || !this.client.cs2Vm?.context.getStatXp) {
            const loggedOut = this.client.gameState === 10 || this.client.gameState === 50;
            if (loggedOut && this.config.resetOnLogout()) this.session.clear();
            else if (this.connected) this.session.pause(now);
            this.connected = false; this.commit(); return;
        }
        const index = this.client.playerEcs.getIndexForServerId(this.client.controlledPlayerServerId);
        const account = index === undefined ? "" : this.client.playerEcs.getName(index);
        if (!account) return;
        const xp = Array.from({ length: SKILL_COUNT }, (_, skill) => this.client.cs2Vm.context.getStatXp!(skill));
        this.session.resume(now);
        this.session.update(account, xp, now, !this.connected);
        this.connected = true; this.commit();
    }
}
