import {
    MAX_VIRTUAL_LEVEL,
    MAX_XP,
    SKILL_IDS,
    SkillId,
    getLevelForXp,
    getXpForLevel,
} from "../../../rs/skill/skills";
import type { XpPanelLabel, XpProgressBarLabel } from "./XpTrackerConfig";

/** The value RuneLite shows as "N/A" (Integer.MAX_VALUE). */
export const UNKNOWN = 2147483647;

const ACTION_HISTORY = 10;

/** RuneLite's XpUpdateResult. */
export type XpUpdateResult = "NO_CHANGE" | "INITIALIZED" | "UPDATED";

/** RuneLite's XpGoalTimeType. */
export type XpGoalTimeType = "DAYS" | "HOURS" | "SHORT";

/** One skill's (or the total's) tracker: RuneLite's XpStateSingle. */
export class XpStateSingle {
    startXp: number;
    xpGainedBeforeReset = 0;
    xpGainedSinceReset = 0;
    /** Milliseconds this skill has been tracked while gaining and unpaused. */
    skillTime = 0;
    lastChangeMillis = 0;
    actions = 0;
    actionsSinceReset = 0;
    startLevelExp = 0;
    endLevelExp = 0;
    private readonly actionExps = new Array<number>(ACTION_HISTORY).fill(0);
    private actionExpIndex = 0;
    private actionsHistoryInitialized = false;

    constructor(startXp: number) {
        this.startXp = startXp;
    }

    static fromSave(save: XpSaveSingle): XpStateSingle {
        const state = new XpStateSingle(save.s);
        state.xpGainedBeforeReset = save.br;
        state.xpGainedSinceReset = save.ar;
        state.skillTime = save.t;
        return state;
    }

    toSave(): XpSaveSingle {
        return { s: this.startXp, br: this.xpGainedBeforeReset, ar: this.xpGainedSinceReset, t: this.skillTime };
    }

    get totalXpGained(): number {
        return this.xpGainedBeforeReset + this.xpGainedSinceReset;
    }

    get currentXp(): number {
        return this.startXp + this.totalXpGained;
    }

    /** Counts a change of experience as one action. False when the experience is unchanged. */
    update(currentXp: number, now: number): boolean {
        if (this.startXp === -1) return false;
        const actionExp = currentXp - (this.startXp + this.totalXpGained);
        if (actionExp === 0) return false;
        if (this.actionsHistoryInitialized) {
            this.actionExps[this.actionExpIndex] = actionExp;
        } else {
            this.actionExps.fill(actionExp);
            this.actionsHistoryInitialized = true;
        }
        this.actionExpIndex = (this.actionExpIndex + 1) % ACTION_HISTORY;
        this.actions++;
        this.actionsSinceReset++;
        this.xpGainedSinceReset = currentXp - (this.startXp + this.xpGainedBeforeReset);
        this.lastChangeMillis = now;
        return true;
    }

    /**
     * The goal range: the in-game XP-drop goal when it is set and not yet passed, else the
     * current level to the next (200M past the last virtual level).
     */
    updateGoals(currentXp: number, goalStartXp: number, goalEndXp: number): void {
        const passed = currentXp > goalEndXp;
        const level = getLevelForXp(currentXp);
        this.startLevelExp = goalStartXp < 0 || passed ? getXpForLevel(level) : goalStartXp;
        if (goalEndXp <= 0 || passed) {
            this.endLevelExp = level + 1 <= MAX_VIRTUAL_LEVEL ? getXpForLevel(level + 1) : MAX_XP;
        } else {
            this.endLevelExp = goalEndXp;
        }
    }

    /** Adds tracked time; only a skill that has gained since its last reset accrues it. */
    tick(delta: number): void {
        if (this.xpGainedSinceReset > 0) this.skillTime += delta;
    }

    /** RuneLite's "Reset/hr": rates start again, the session's gains are kept. */
    resetPerHour(now: number): void {
        this.actionsSinceReset = 0;
        this.xpGainedBeforeReset += this.xpGainedSinceReset;
        this.xpGainedSinceReset = 0;
        this.lastChangeMillis = now;
        this.skillTime = 0;
    }

    private get secondsElapsed(): number {
        return Math.max(60, Math.floor(this.skillTime / 1000));
    }

    private toHourly(value: number): number {
        return Math.trunc((1.0 / (this.secondsElapsed / 3600.0)) * value);
    }

    get xpPerHour(): number {
        return this.toHourly(this.xpGainedSinceReset);
    }

    get actionsPerHour(): number {
        return this.toHourly(this.actionsSinceReset);
    }

    get xpRemaining(): number {
        return this.endLevelExp - this.currentXp;
    }

    get actionsRemaining(): number {
        if (!this.actionsHistoryInitialized) return UNKNOWN;
        const sum = this.actionExps.reduce((a, b) => a + b, 0);
        if (sum <= 0) return UNKNOWN;
        const x = this.xpRemaining * ACTION_HISTORY;
        return Math.floor(x / sum) + (x % sum !== 0 ? 1 : 0);
    }

    get progress(): number {
        return ((this.currentXp - this.startLevelExp) / (this.endLevelExp - this.startLevelExp)) * 100;
    }

    /** Seconds to the goal at the current rate, or -1 with no gain since the last reset. */
    get secondsTillLevel(): number {
        if (this.xpGainedSinceReset <= 0) return -1;
        return Math.floor((this.xpRemaining * this.secondsElapsed) / this.xpGainedSinceReset);
    }

    timeTillLevel(type: XpGoalTimeType): string {
        return formatTimeTillGoal(this.secondsTillLevel, type);
    }

    snapshot(): XpSnapshotSingle {
        return {
            startLevel: getLevelForXp(this.startLevelExp),
            endLevel: getLevelForXp(this.endLevelExp),
            xpGainedInSession: this.totalXpGained,
            xpRemainingToGoal: this.xpRemaining,
            xpPerHour: this.xpPerHour,
            skillProgressToGoal: this.progress,
            actionsInSession: this.actions,
            actionsRemainingToGoal: this.actionsRemaining,
            actionsPerHour: this.actionsPerHour,
            timeTillGoal: this.timeTillLevel("DAYS"),
            timeTillGoalHours: this.timeTillLevel("HOURS"),
            timeTillGoalShort: this.timeTillLevel("SHORT"),
            startGoalXp: this.startLevelExp,
            endGoalXp: this.endLevelExp,
        };
    }
}

/** What the panel and the canvas boxes draw: RuneLite's XpSnapshotSingle. */
export type XpSnapshotSingle = {
    startLevel: number;
    endLevel: number;
    xpGainedInSession: number;
    xpRemainingToGoal: number;
    xpPerHour: number;
    skillProgressToGoal: number;
    actionsInSession: number;
    actionsRemainingToGoal: number;
    actionsPerHour: number;
    timeTillGoal: string;
    timeTillGoalHours: string;
    timeTillGoalShort: string;
    startGoalXp: number;
    endGoalXp: number;
};

/** RuneLite's XpSaveSingle, with its short JSON names. */
export type XpSaveSingle = { s: number; br: number; ar: number; t: number };

/** RuneLite's XpSave: skills in panel order, compact-view skills, and the total. */
export type XpSave = {
    skills: Partial<Record<string, XpSaveSingle>>;
    compactViewSkills: string[];
    overall: XpSaveSingle;
};

/** All trackers: RuneLite's XpState. Skills are keyed by SkillId; `order` is the panel order. */
export class XpState {
    private readonly skills = new Map<SkillId, XpStateSingle>();
    overall = new XpStateSingle(-1);
    order: SkillId[] = [];
    readonly compactView = new Set<SkillId>();

    reset(): void {
        this.skills.clear();
        this.overall = new XpStateSingle(-1);
        this.order = [];
        this.compactView.clear();
    }

    get(skill: SkillId): XpStateSingle | undefined {
        return this.skills.get(skill);
    }

    isInitialized(skill: SkillId): boolean {
        const state = this.skills.get(skill);
        return state !== undefined && state.startXp !== -1;
    }

    isOverallInitialized(): boolean {
        return this.overall.startXp !== -1;
    }

    /** A fresh tracker baselined at the current experience: RuneLite's resetSkill. */
    resetSkill(skill: SkillId, currentXp: number): void {
        this.skills.set(skill, new XpStateSingle(currentXp));
        this.order = this.order.filter((s) => s !== skill);
        this.compactView.delete(skill);
    }

    updateSkill(
        skill: SkillId,
        currentXp: number,
        goalStartXp: number,
        goalEndXp: number,
        now: number,
        prioritizeRecent: boolean,
    ): XpUpdateResult {
        const state = this.skills.get(skill);
        if (!state || state.startXp === -1 || state.currentXp > currentXp) {
            // New, or experience went down (a reset lamp, a different account): start over.
            this.initializeSkill(skill, currentXp, goalStartXp, goalEndXp);
            return "INITIALIZED";
        }
        if (!state.update(currentXp, now)) return "NO_CHANGE";
        state.updateGoals(currentXp, goalStartXp, goalEndXp);
        if (prioritizeRecent) {
            this.order = [skill, ...this.order.filter((s) => s !== skill)];
        } else if (!this.order.includes(skill)) {
            this.order.push(skill);
        }
        return "UPDATED";
    }

    private initializeSkill(skill: SkillId, currentXp: number, goalStartXp: number, goalEndXp: number): void {
        const state = new XpStateSingle(currentXp);
        state.updateGoals(currentXp, goalStartXp, goalEndXp);
        this.skills.set(skill, state);
    }

    initializeOverall(currentXp: number): void {
        this.overall = new XpStateSingle(currentXp);
    }

    updateOverall(currentXp: number, now: number): void {
        if (this.overall.startXp + this.overall.totalXpGained > currentXp) {
            this.overall = new XpStateSingle(currentXp);
        }
        this.overall.update(currentXp, now);
    }

    /** Adds time to one skill, and resets its rates after `resetAfterMinutes` without XP. */
    tick(skill: SkillId, delta: number, now: number, resetAfterMinutes: number): void {
        const state = this.skills.get(skill);
        if (!state) return;
        state.tick(delta);
        if (resetAfterMinutes > 0 && state.lastChangeMillis !== 0 &&
            now - state.lastChangeMillis >= resetAfterMinutes * 60_000) {
            state.resetPerHour(now);
        }
    }

    tickOverall(delta: number, now: number, resetAfterMinutes: number): void {
        this.overall.tick(delta);
        if (resetAfterMinutes > 0 && this.overall.lastChangeMillis !== 0 &&
            now - this.overall.lastChangeMillis >= resetAfterMinutes * 60_000) {
            this.overall.resetPerHour(now);
        }
    }

    /** Null until the total is tracking; only skills with gains are kept, in panel order. */
    save(): XpSave | null {
        if (!this.isOverallInitialized()) return null;
        const skills: Record<string, XpSaveSingle> = {};
        for (const skill of this.order) {
            const state = this.skills.get(skill);
            if (state && state.totalXpGained > 0) skills[SkillId[skill].toUpperCase()] = state.toSave();
        }
        return {
            skills,
            compactViewSkills: [...this.compactView].map((s) => SkillId[s].toUpperCase()),
            overall: this.overall.toSave(),
        };
    }

    restore(save: XpSave): void {
        this.reset();
        for (const [name, single] of Object.entries(save.skills ?? {})) {
            const skill = skillByName(name);
            if (skill === undefined || !single) continue;
            this.skills.set(skill, XpStateSingle.fromSave(single));
            this.order.push(skill);
        }
        for (const name of save.compactViewSkills ?? []) {
            const skill = skillByName(name);
            if (skill !== undefined) this.compactView.add(skill);
        }
        if (save.overall) this.overall = XpStateSingle.fromSave(save.overall);
    }
}

/** A skill from its RuneLite name (`ATTACK`, `RUNECRAFT`...). */
export function skillByName(name: string): SkillId | undefined {
    const lower = String(name).toLowerCase();
    return SKILL_IDS.find((id) => SkillId[id].toLowerCase() === lower);
}

/** Why a skill is paused: RuneLite's XpPauseStateSingle reasons. */
type PauseReason = "MANUAL" | "LOGOUT" | "TIMEOUT";

class PauseStateSingle {
    readonly reasons = new Set<PauseReason>();
    xp = 0;
    lastChangeMillis = 0;
}

/** Pause bookkeeping per skill and for the total: RuneLite's XpPauseState. */
export class XpPauseState {
    private readonly skills = new Map<SkillId, PauseStateSingle>();
    private readonly overall = new PauseStateSingle();
    private loggedIn = false;

    private state(skill: SkillId): PauseStateSingle {
        let state = this.skills.get(skill);
        if (!state) this.skills.set(skill, (state = new PauseStateSingle()));
        return state;
    }

    isPaused(skill: SkillId): boolean {
        return this.state(skill).reasons.size > 0;
    }

    isOverallPaused(): boolean {
        return this.overall.reasons.size > 0;
    }

    pauseSkill(skill: SkillId): void {
        this.state(skill).reasons.add("MANUAL");
    }

    unpauseSkill(skill: SkillId, now: number): void {
        const state = this.state(skill);
        state.reasons.clear();
        state.lastChangeMillis = now;
    }

    pauseOverall(): void {
        this.overall.reasons.add("MANUAL");
    }

    unpauseOverall(now: number): void {
        this.overall.reasons.clear();
        this.overall.lastChangeMillis = now;
    }

    /** Any change of experience unpauses; none for `pauseAfterMinutes` pauses (timeout). */
    tickXp(skill: SkillId, currentXp: number, pauseAfterMinutes: number, now: number): void {
        this.tickSingle(this.state(skill), currentXp, pauseAfterMinutes, now);
    }

    tickOverallXp(currentXp: number, pauseAfterMinutes: number, now: number): void {
        this.tickSingle(this.overall, currentXp, pauseAfterMinutes, now);
    }

    private tickSingle(state: PauseStateSingle, xp: number, pauseAfterMinutes: number, now: number): void {
        if (state.xp !== xp) {
            state.xp = xp;
            state.lastChangeMillis = now;
            state.reasons.clear();
        } else if (pauseAfterMinutes > 0 && state.lastChangeMillis !== 0 &&
            now - state.lastChangeMillis >= pauseAfterMinutes * 60_000) {
            state.reasons.add("TIMEOUT");
        }
    }

    /** Logging out pauses everything (when enabled); logging in lifts that pause only. */
    tickLogout(pauseOnLogout: boolean, loggedIn: boolean): void {
        if (loggedIn === this.loggedIn) return;
        this.loggedIn = loggedIn;
        const all = [...SKILL_IDS.map((s) => this.state(s)), this.overall];
        for (const state of all) {
            if (loggedIn) state.reasons.delete("LOGOUT");
            else if (pauseOnLogout) state.reasons.add("LOGOUT");
        }
    }
}

/** RuneLite's time-to-goal text; ∞ when there is no rate yet. */
export function formatTimeTillGoal(seconds: number, type: XpGoalTimeType): string {
    if (seconds < 0) return "∞";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const hoursTotal = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const two = (n: number) => String(n).padStart(2, "0");
    if (type === "DAYS") {
        if (days > 1) return `${days} days ${two(hours)}:${two(minutes)}:${two(secs)}`;
        if (days === 1) return `1 day ${two(hours)}:${two(minutes)}:${two(secs)}`;
    }
    if (type === "DAYS" || type === "HOURS") {
        if (hoursTotal > 1) return `${hoursTotal} hours ${two(minutes)}:${two(secs)}`;
        if (hoursTotal === 1) return `1 hour ${two(minutes)}:${two(secs)}`;
    }
    if (hoursTotal > 0) return `${hoursTotal}:${two(minutes)}:${two(secs)}`;
    return `${two(minutes)}:${two(secs)}`;
}

const SUFFIXES = ["", "K", "M", "B"];

/**
 * RuneLite's QuantityFormatter.quantityToRSDecimalStack(quantity, true): up to four digits as
 * they are, else K/M/B with one decimal (three from a million), always rounded down.
 */
export function quantityToRSDecimalStack(quantity: number): string {
    const text = String(quantity);
    if (text.length <= 4) return text;
    const power = Math.floor(Math.log10(quantity));
    const decimals = power >= 6 ? 3 : 1;
    const divisor = Math.pow(10, Math.floor(power / 3) * 3);
    const scaled = Math.floor((quantity * Math.pow(10, decimals)) / divisor);
    const whole = Math.floor(scaled / Math.pow(10, decimals));
    const fraction = String(scaled % Math.pow(10, decimals)).padStart(decimals, "0").replace(/0+$/, "");
    return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}${SUFFIXES[Math.floor(power / 3)]}`;
}

const COMBAT_SKILLS: ReadonlySet<SkillId> = new Set([
    SkillId.Attack, SkillId.Strength, SkillId.Defence, SkillId.Hitpoints, SkillId.Ranged,
]);

/** RuneLite's info box leaves action labels empty for these. */
export function isCombatSkill(skill: SkillId): boolean {
    return COMBAT_SKILLS.has(skill);
}

function formatCount(value: number): string {
    return value === UNKNOWN ? "N/A" : quantityToRSDecimalStack(value);
}

/** One label's value: RuneLite's XpPanelLabel value functions. */
export function panelLabelValue(label: XpPanelLabel, snapshot: XpSnapshotSingle): string {
    switch (label) {
        case "TIME_TO_LEVEL": return snapshot.timeTillGoalShort;
        case "XP_GAINED": return formatCount(snapshot.xpGainedInSession);
        case "XP_HOUR": return formatCount(snapshot.xpPerHour);
        case "XP_LEFT": return formatCount(snapshot.xpRemainingToGoal);
        case "ACTIONS_LEFT": return formatCount(snapshot.actionsRemainingToGoal);
        case "ACTIONS_HOUR": return formatCount(snapshot.actionsPerHour);
        case "ACTIONS_DONE": return formatCount(snapshot.actionsInSession);
    }
}

export function isActionLabel(label: XpPanelLabel): boolean {
    return label === "ACTIONS_LEFT" || label === "ACTIONS_HOUR" || label === "ACTIONS_DONE";
}

/** RuneLite's XpProgressBarLabel values; the percentage keeps two decimals, rounded down. */
export function progressBarLabelValue(label: XpProgressBarLabel, snapshot: XpSnapshotSingle): string {
    switch (label) {
        case "PERCENTAGE": return `${(Math.floor(snapshot.skillProgressToGoal * 100) / 100).toFixed(2)}%`;
        case "TIME_TO_LEVEL": return snapshot.timeTillGoal;
        case "HOURS_TO_LEVEL": return snapshot.timeTillGoalHours;
    }
}
