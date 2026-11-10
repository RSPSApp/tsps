/*
 * Ported from l2-'s Customizable XP drops (upstream commit 3835071).
 * Copyright (c) 2021, l2-
 * SPDX-License-Identifier: BSD-2-Clause
 * See LICENSE in this directory.
 */
import { SkillId } from "../../../rs/skill/skills";
import { HorizontalDirection, PredictedHitIconStyle, VerticalDirection, XpTrackerSkill } from "./CustomXpDropsConfig";

/**
 * The drop logic of Customizable XP Drops (XpDropOverlayManager, XpDropMerger and the plugin's
 * queues), free of the client so it can be tested: XP gains and predicted hits go in, drops in
 * flight (with their offset, alpha and frame) come out.
 */

/** The overall total, after the 24 skills (the plugin's Skill.OVERALL). */
export const OVERALL = 24;

/** Each skill's place in the vanilla drop order, by SkillId (CustomizableXpDropsPlugin.SKILL_PRIORITY). */
export const SKILL_PRIORITY: readonly number[] = [
    1, 5, 2, 6, 3, 7, 4, 15, 17, 18, 0, 16, 11, 14, 13, 9, 8, 10, 19, 20, 12, 22, 21, 23,
];
/** The skill at each place: SKILL_PRIORITY inverted (XpDropOverlayManager.SKILL_INDICES). */
export const SKILL_INDICES: readonly number[] = [
    10, 0, 2, 4, 6, 1, 3, 5, 16, 15, 17, 12, 20, 14, 13, 7, 11, 8, 9, 18, 19, 22, 21, 23,
];
export const SKILL_COUNT = SKILL_PRIORITY.length;
/** Flag bits: one per skill by priority, then the fake-drop icon and the hitsplat icon. */
export const FAKE_SKILL_ICON_INDEX = SKILL_COUNT;
export const HITSPLAT_ICON_INDEX = SKILL_COUNT + 1;
export const SKILL_FLAGS_MASK = (1 << SKILL_COUNT) - 1;
export const HITSPLAT_FLAGS_MASK = 1 << HITSPLAT_ICON_INDEX;

export const FRAMES_PER_SECOND = 50;
export const CONSTANT_FRAME_TIME = 1000 / FRAMES_PER_SECOND;

/** The skill names the filters match (the skills tab's, lower case), by SkillId. */
export const SKILL_NAMES: readonly string[] = [
    "Attack", "Defence", "Strength", "Hitpoints", "Ranged", "Prayer", "Magic", "Cooking", "Woodcutting",
    "Fletching", "Fishing", "Firemaking", "Crafting", "Smithing", "Mining", "Herblore", "Agility", "Thieving",
    "Slayer", "Farming", "Runecraft", "Hunter", "Construction", "Sailing",
];

export enum XpDropStyle {
    DEFAULT = "DEFAULT",
    MELEE = "MELEE",
    MAGE = "MAGE",
    RANGE = "RANGE",
}

/** The attack styles a weapon category's style slots map to (RuneLite's AttackStyle). */
export enum AttackStyle {
    ACCURATE = "ACCURATE",
    AGGRESSIVE = "AGGRESSIVE",
    DEFENSIVE = "DEFENSIVE",
    CONTROLLED = "CONTROLLED",
    RANGING = "RANGING",
    LONGRANGE = "LONGRANGE",
    CASTING = "CASTING",
    DEFENSIVE_CASTING = "DEFENSIVE_CASTING",
    OTHER = "OTHER",
}

/** The skills each style trains; the first is the predicted hit's skill icon. */
export const ATTACK_STYLE_SKILLS: Record<AttackStyle, readonly SkillId[]> = {
    [AttackStyle.ACCURATE]: [SkillId.Attack],
    [AttackStyle.AGGRESSIVE]: [SkillId.Strength],
    [AttackStyle.DEFENSIVE]: [SkillId.Defence],
    [AttackStyle.CONTROLLED]: [SkillId.Attack, SkillId.Strength, SkillId.Defence],
    [AttackStyle.RANGING]: [SkillId.Ranged],
    [AttackStyle.LONGRANGE]: [SkillId.Ranged, SkillId.Defence],
    [AttackStyle.CASTING]: [SkillId.Magic],
    [AttackStyle.DEFENSIVE_CASTING]: [SkillId.Magic, SkillId.Defence],
    [AttackStyle.OTHER]: [],
};

/** An actor the player attacked: where an attached drop is drawn. */
export type TargetActor = { type: "npc" | "player"; serverId: number; npcTypeId: number };

export type XpDrop = { skill: SkillId; experience: number; style: XpDropStyle; target?: TargetActor };

/**
 * A Hitpoints gain against a target (the plugin's Hit and PredictedHit): its hit is worked out
 * when it is drawn, by then with the rate the server sent alongside the gain.
 */
export type PendingHit = { hpXp: number; modifier: number; target?: TargetActor; style?: AttackStyle };

export type XpDropInFlight = {
    /** Icons drawn, as flag bits. */
    icons: number;
    /** The icons it would have with every icon setting on. */
    flags: number;
    amount: number;
    style: XpDropStyle;
    yOffset: number;
    xOffset: number;
    alpha: number;
    frame: number;
    hit: number;
    target?: TargetActor;
    /** Just a predicted hit, not an XP drop. */
    isPredictedHit: boolean;
    tick: number;
};

/** The settings the drops read (XpDropsConfig's values, as plain data). */
export type DropSettings = {
    isGrouped: boolean;
    groupedDelay: number;
    yPixelsPerSecond: number;
    yDirection: VerticalDirection;
    xPixelsPerSecond: number;
    xDirection: HorizontalDirection;
    framesPerDrop: number;
    fadeOut: boolean;
    showIcons: boolean;
    showPredictedHit: boolean;
    neverGroupPredictedHit: boolean;
    predictedHitIcon: PredictedHitIconStyle;
    filteredSkills: ReadonlySet<string>;
    filteredSkillsPredictedHits: ReadonlySet<string>;
    xpTrackerSkill: XpTrackerSkill;
    xpTrackerClientTicksToLinger: number;
    /** The predicted hit's divisor: the server's Hitpoints XP rate times "Xp multiplier". */
    xpRate: number;
};

/** "Skills to filter": comma-separated names, lower case; "runecrafting" also matches Runecraft. */
export function parseSkillFilter(csv: string): Set<string> {
    const names = new Set(String(csv ?? "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean));
    if (names.has("runecrafting")) names.add("runecraft");
    return names;
}

/** "Predicted hit xp modifiers": `npcId:modifier` per line; bad lines are skipped, a later id wins. */
export function parseXpModifiers(text: string): Map<number, number> {
    const modifiers = new Map<number, number>();
    for (const line of String(text ?? "").split(/\r?\n/)) {
        const [id, value] = line.split(":");
        if (value === undefined) continue;
        const npcId = Number(id.trim());
        const modifier = Number(value.trim());
        if (id.trim() === "" || value.trim() === "" || !Number.isInteger(npcId) || !Number.isFinite(modifier)) continue;
        modifiers.set(npcId, modifier);
    }
    return modifiers;
}

/**
 * XpDropDamageCalculator.calculateHit: Hitpoints pays 4/3 XP per damage, so the hit is 3/4 of
 * the gain, over the target's modifier and the rate the gain was paid at.
 */
export function calculateHit(hpXp: number, modifier: number, rate: number): number {
    const divisor = Math.abs(rate) < 1e-6 ? 1e-6 : rate;
    if (modifier < 1e-6) return 0;
    return Math.round((hpXp * (3 / 4)) / modifier / divisor);
}

/** The XP drop number as "###,###,###". */
export function formatXp(amount: number): string {
    return Math.round(amount).toLocaleString("en-US");
}

/** The tracker's skill for a fixed setting (OVERALL for the total); undefined for most recent. */
export function trackerSkillOf(setting: XpTrackerSkill): number | undefined {
    if (setting === XpTrackerSkill.MOST_RECENT) return undefined;
    if (setting === XpTrackerSkill.OVERALL) return OVERALL;
    const index = SKILL_NAMES.findIndex((name) => name.toUpperCase() === setting);
    return index >= 0 ? index : OVERALL;
}

/** XpDropOverlayUtilities' drop text: the XP (or hit) with its prefix and suffix, then " (hit)". */
export type TextPart = { text: string; color: number };

export type TextSettings = {
    xpDropPrefix: string;
    xpDropSuffix: string;
    predictedHitPrefix: string;
    predictedHitSuffix: string;
    predictedHitColorOverride: boolean;
    predictedHitColor: number;
    colors: Record<XpDropStyle, number>;
};

export function dropText(drop: XpDropInFlight, settings: TextSettings): TextPart[] {
    const color = settings.colors[drop.style] ?? 0xffffffff;
    const amount = formatXp(drop.amount);
    const parts: TextPart[] = drop.isPredictedHit
        ? [{
            text: settings.predictedHitPrefix + amount + settings.predictedHitSuffix,
            color: settings.predictedHitColorOverride ? settings.predictedHitColor : color,
        }]
        : [{ text: settings.xpDropPrefix + amount + settings.xpDropSuffix, color }];
    if (drop.hit > 0) {
        parts.push({
            text: ` (${settings.predictedHitPrefix}${drop.hit}${settings.predictedHitSuffix})`,
            color: settings.predictedHitColorOverride ? settings.predictedHitColor : color,
        });
    }
    return parts;
}

const priorityOf = (drop: XpDrop) => SKILL_PRIORITY[drop.skill];

/** The drops in the order the plugin's PriorityQueue polls them: vanilla drop order. */
function byPriority(queue: XpDrop[]): XpDrop[] {
    return [...queue].sort((a, b) => priorityOf(a) - priorityOf(b));
}

function findLast<T>(list: T[], test: (value: T) => boolean): T | undefined {
    for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return list[i];
    return undefined;
}

function merge(into: XpDropInFlight, from: XpDropInFlight): void {
    into.icons |= from.icons;
    into.amount += from.amount;
    into.style = into.style === XpDropStyle.DEFAULT ? from.style : into.style;
    into.hit += from.hit;
    into.target = into.target ?? from.target;
}

function groupBy<T, K>(list: T[], key: (value: T) => K): Map<K, T[]> {
    const groups = new Map<K, T[]>();
    for (const value of list) {
        const k = key(value);
        const group = groups.get(k);
        if (group) group.push(value);
        else groups.set(k, [value]);
    }
    return groups;
}

/**
 * XpDropMerger: the client can report one tick's gains across frames, so a new drop from a tick
 * that already has one in flight joins it rather than starting another.
 */
export function mergeXpDrops(incoming: XpDropInFlight[], inFlight: XpDropInFlight[], settings: DropSettings): void {
    const absorb = (groups: Map<unknown, XpDropInFlight[]>, match: (key: unknown, drop: XpDropInFlight) => boolean) => {
        for (const [key, group] of groups) {
            const into = findLast(inFlight, (drop) => match(key, drop));
            if (!into) continue;
            for (const drop of group) merge(into, drop);
            for (const drop of group) incoming.splice(incoming.indexOf(drop), 1);
        }
    };
    if (settings.showPredictedHit && settings.neverGroupPredictedHit) {
        absorb(groupBy(incoming.filter((d) => d.isPredictedHit), (d) => d.tick),
            (tick, drop) => drop.isPredictedHit && drop.tick === tick);
    }
    if (settings.isGrouped) {
        absorb(groupBy(incoming.filter((d) => !d.isPredictedHit), (d) => d.tick),
            (tick, drop) => !drop.isPredictedHit && drop.tick === tick);
        return;
    }
    absorb(groupBy(incoming.filter((d) => !d.isPredictedHit), (d) => `${d.icons}:${d.tick}`),
        (key, drop) => !drop.isPredictedHit && `${drop.icons}:${drop.tick}` === key);
    incoming.sort((a, b) => {
        if (a.isPredictedHit !== b.isPredictedHit) return a.isPredictedHit ? -1 : 1;
        return (a.flags & SKILL_FLAGS_MASK) - (b.flags & SKILL_FLAGS_MASK);
    });
    // One tick's ungrouped drops all show its hit and its prayer colour.
    for (const group of groupBy(inFlight.filter((d) => !d.isPredictedHit), (d) => d.tick).values()) {
        const withHit = findLast(group, (d) => d.hit > 0);
        if (!withHit) continue;
        for (const drop of group) drop.hit = withHit.hit;
        const styled = findLast(group, (d) => d.style !== XpDropStyle.DEFAULT);
        if (!styled) continue;
        for (const drop of group) drop.style = styled.style;
    }
}

/** The drops and the tracker's skill over time (XpDropOverlayManager.update). */
export class XpDropState {
    readonly queue: XpDrop[] = [];
    readonly hits: PendingHit[] = [];
    readonly inFlight: XpDropInFlight[] = [];
    /** The tracker's skill: a SkillId or OVERALL. */
    lastSkill = OVERALL;
    /** When the tracker last switched skill (or was refreshed), for its fade. */
    lastSkillSetMillis = 0;
    private lastFrameTime = 0;

    reset(): void {
        this.queue.length = 0;
        this.hits.length = 0;
        this.inFlight.length = 0;
        this.lastFrameTime = 0;
    }

    /** One frame: the tracker's skill, the drops' movement and fade, and this frame's new drops. */
    update(now: number, tick: number, settings: DropSettings): void {
        if (this.lastFrameTime <= 0) this.lastFrameTime = now - 20;
        this.refreshXpTracker(now, settings);
        this.updateDrops(now, settings);
        this.pollDrops(tick, settings);
        this.lastFrameTime = now;
    }

    private refreshXpTracker(now: number, settings: DropSettings): void {
        if (this.queue.length > 0 || settings.xpTrackerClientTicksToLinger === 0) {
            const fixed = trackerSkillOf(settings.xpTrackerSkill);
            if (fixed !== undefined) {
                this.switchTrackerTo(fixed, now);
            } else {
                const recent = byPriority(this.queue).find((drop) =>
                    !settings.filteredSkills.has(SKILL_NAMES[drop.skill].toLowerCase()));
                if (recent) this.switchTrackerTo(recent.skill, now);
            }
        }
        if (this.lastSkillSetMillis <= 0) this.lastSkillSetMillis = now;
    }

    private switchTrackerTo(skill: number, now: number): void {
        this.lastSkillSetMillis = now;
        this.lastSkill = skill;
    }

    private updateDrops(now: number, settings: DropSettings): void {
        const framesPerDrop = settings.framesPerDrop;
        for (let i = this.inFlight.length - 1; i >= 0; i--) {
            if (this.inFlight[i].frame > framesPerDrop) this.inFlight.splice(i, 1);
        }
        const xModifier = settings.xDirection === HorizontalDirection.LEFT ? -1 : 1;
        const yModifier = settings.yDirection === VerticalDirection.UP ? -1 : 1;
        const frameTimeModifier = (now - this.lastFrameTime) / CONSTANT_FRAME_TIME;
        for (const drop of this.inFlight) {
            if (drop.frame >= 0) {
                drop.xOffset += (settings.xPixelsPerSecond / FRAMES_PER_SECOND) * xModifier * frameTimeModifier;
                drop.yOffset += (settings.yPixelsPerSecond / FRAMES_PER_SECOND) * yModifier * frameTimeModifier;
            }
            drop.frame += frameTimeModifier;
        }
        if (settings.fadeOut) {
            const threshold = Math.trunc(0.66 * framesPerDrop);
            const delta = framesPerDrop - threshold;
            for (const drop of this.inFlight) {
                if (drop.frame <= threshold) continue;
                const fade = Math.max(0, Math.min(1, (Math.trunc(drop.frame) - threshold) / delta));
                drop.alpha = Math.max(0, 0xff - fade * 0xff);
            }
        }
    }

    private pollDrops(tick: number, settings: DropSettings): void {
        let lastFrame = 0;
        if (this.inFlight.length > 0) lastFrame = this.inFlight[this.inFlight.length - 1].frame - settings.groupedDelay;

        const drops: XpDropInFlight[] = [];
        let totalHit = 0;
        let hitStyle: AttackStyle | undefined;
        let target: TargetActor | undefined;
        for (const hit of this.hits.splice(0)) {
            totalHit += calculateHit(hit.hpXp, hit.modifier, settings.xpRate);
            target = hit.target;
            hitStyle = hit.style;
        }
        if (!settings.showPredictedHit) totalHit = 0;

        const queued = byPriority(this.queue.splice(0));
        let filteredHit = false;
        let style = XpDropStyle.DEFAULT;
        for (const drop of queued) {
            filteredHit ||= settings.filteredSkillsPredictedHits.has(SKILL_NAMES[drop.skill].toLowerCase());
            if (drop.style !== XpDropStyle.DEFAULT) style = drop.style;
        }
        const groupedHit = settings.neverGroupPredictedHit || filteredHit ? 0 : totalHit;
        const flight = (icons: number, flags: number, amount: number, hit: number, to: TargetActor | undefined,
            isPredictedHit: boolean): XpDropInFlight =>
            ({ icons, flags, amount, style, yOffset: 0, xOffset: 0, alpha: 0xff, frame: 0, hit, target: to, isPredictedHit, tick });

        if (settings.showPredictedHit && settings.neverGroupPredictedHit && totalHit > 0 && !filteredHit) {
            const skill = hitStyle ? ATTACK_STYLE_SKILLS[hitStyle][0] : undefined;
            let flags = HITSPLAT_FLAGS_MASK;
            if (skill !== undefined) flags |= 1 << SKILL_PRIORITY[skill];
            let icons = 0;
            if (settings.predictedHitIcon === PredictedHitIconStyle.SKILL || settings.predictedHitIcon === PredictedHitIconStyle.HITSPLAT_SKILL) {
                icons |= flags & SKILL_FLAGS_MASK;
            }
            if (settings.predictedHitIcon === PredictedHitIconStyle.HITSPLAT || settings.predictedHitIcon === PredictedHitIconStyle.HITSPLAT_SKILL) {
                icons |= flags & HITSPLAT_FLAGS_MASK;
            }
            drops.push(flight(icons, flags, totalHit, 0, target, true));
        }

        const shown = queued.filter((drop) => !settings.filteredSkills.has(SKILL_NAMES[drop.skill].toLowerCase()));
        if (settings.isGrouped) {
            let amount = 0;
            let flags = 0;
            for (const drop of shown) {
                amount += drop.experience;
                flags |= 1 << SKILL_PRIORITY[drop.skill];
            }
            if (amount > 0) {
                drops.push(flight(settings.showIcons ? flags & SKILL_FLAGS_MASK : 0, flags, amount, groupedHit, target, false));
            }
        } else {
            const bySkill = new Map<SkillId, XpDropInFlight>();
            for (const drop of shown) {
                const existing = bySkill.get(drop.skill);
                if (existing) {
                    existing.hit = groupedHit;
                    existing.amount += drop.experience;
                    continue;
                }
                const flags = 1 << SKILL_PRIORITY[drop.skill];
                const created = flight(settings.showIcons ? flags & SKILL_FLAGS_MASK : 0, flags, drop.experience,
                    groupedHit, drop.target, false);
                bySkill.set(drop.skill, created);
                drops.push(created);
            }
        }

        mergeXpDrops(drops, this.inFlight, settings);

        lastFrame = Math.min(0, lastFrame);
        drops.forEach((drop, index) => {
            drop.frame = -index * settings.groupedDelay + lastFrame;
            this.inFlight.push(drop);
        });
    }
}

/** The overlay box's size without icons (XpDropOverlay.render): the widest number plus the travel. */
export function dropBoxSize(textWidth: number, lineHeight: number, settings: DropSettings): { width: number; height: number } {
    return {
        width: textWidth + Math.abs((settings.framesPerDrop * settings.xPixelsPerSecond) / FRAMES_PER_SECOND),
        height: lineHeight + Math.abs((settings.framesPerDrop * settings.yPixelsPerSecond) / FRAMES_PER_SECOND),
    };
}

/** The tracker's alpha (XpTrackerOverlay.getAlpha): 0-255, fading out once it has lingered. */
export function trackerAlpha(now: number, lastSkillSetMillis: number, linger: number, fadeOut: boolean): number {
    if (linger === 0) return 0xff;
    const ticks = Math.trunc((now - lastSkillSetMillis) / 20);
    if (fadeOut) {
        const delta = Math.min(33, Math.trunc(0.33 * linger));
        const threshold = linger - delta;
        const fade = Math.max(0, Math.min(1, (ticks - threshold) / delta));
        return Math.trunc(Math.max(0, 0xff - fade * 0xff));
    }
    return ticks > linger ? 0 : 0xff;
}

