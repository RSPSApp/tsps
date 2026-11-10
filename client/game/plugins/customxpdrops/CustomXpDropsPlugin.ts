/*
 * Ported from l2-'s Customizable XP drops (upstream commit 3835071).
 * Copyright (c) 2021, l2-
 * SPDX-License-Identifier: BSD-2-Clause
 * See LICENSE in this directory.
 */
import type { Client } from "@runelite/api/Client";
import { GameState } from "@runelite/api/GameState";
import type { ConfigChanged, GameStateChanged, StatChanged } from "@runelite/api/events";
import * as VarbitID from "@runelite/api/gameval/VarbitID";
import * as VarPlayerID from "@runelite/api/gameval/VarPlayerID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { openConfiguration } from "@runelite/client/plugins/config/configurationRequests";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import { toRuneLiteGameState } from "../../../runelite/impl/GameStateMapping";
import { EquipmentDisplaySlot } from "../../../rs/config/player/Equipment";
import { decodeInteractionIndex } from "../../../rs/interaction/InteractionIndex";
import { SKILL_IDS, SkillId } from "../../../rs/skill/skills";
import type { Cs2Vm } from "../../../rs/cs2/Cs2Vm";
import { setHidden } from "../../../widgets/custom/dynamicWidgets";
import type { OsrsClient } from "../../OsrsClient";
import { levelGoals } from "../xpglobes/xpGlobes";
import { XpTrackerPlugin } from "../xptracker/XpTrackerPlugin";
import { CustomXpDropsConfig, XpTrackerSkill } from "./CustomXpDropsConfig";
import { XpDropOverlay } from "./XpDropOverlay";
import { XpTrackerOverlay } from "./XpTrackerOverlay";
import {
    AttackStyle,
    ATTACK_STYLE_SKILLS,
    type DropSettings,
    OVERALL,
    parseSkillFilter,
    parseXpModifiers,
    type TargetActor,
    XpDropState,
    XpDropStyle,
} from "./xpDrops";

/** RuneLite's ScriptID.XPDROPS_SETDROPSIZE: sizes a drop; its first int argument is the drop's widget. */
const XPDROPS_SETDROPSIZE = 996;
/** The vanilla tracker's update script, and the tracker (122:4) it shows. */
const XP_TRACKER_SCRIPT_ID = 997;
const XP_TRACKER_WIDGET = (122 << 16) | 4;
/** The orb's Show/Hide XP drops toggle. */
const EXPERIENCE_TRACKER_TOGGLE = 4702;
/** EnumID.WEAPON_STYLES (weapon category -> its styles' structs) and ParamID.ATTACK_STYLE_NAME. */
const WEAPON_STYLES_ENUM = 3908;
const ATTACK_STYLE_NAME_PARAM = 1407;
/** A Voidwaker's special is a Magic drop that counts towards melee prayers. */
const VOIDWAKER = 27690;

const MELEE_STYLES = [AttackStyle.ACCURATE, AttackStyle.AGGRESSIVE, AttackStyle.CONTROLLED, AttackStyle.DEFENSIVE, AttackStyle.OTHER];
const RANGE_STYLES = [AttackStyle.RANGING, AttackStyle.LONGRANGE, AttackStyle.OTHER];
const MAGE_STYLES = [AttackStyle.CASTING, AttackStyle.DEFENSIVE_CASTING, AttackStyle.OTHER];

/** XpPrayer: each offensive prayer's varbit, the colour it gives a drop and the styles it boosts. */
const XP_PRAYERS: ReadonlyArray<{ varbit: number; type: XpDropStyle; styles: readonly AttackStyle[] }> = [
    { varbit: VarbitID.PRAYER_BURSTOFSTRENGTH, type: XpDropStyle.MELEE, styles: MELEE_STYLES },
    { varbit: VarbitID.PRAYER_CLARITYOFTHOUGHT, type: XpDropStyle.MELEE, styles: MELEE_STYLES },
    { varbit: VarbitID.PRAYER_SHARPEYE, type: XpDropStyle.RANGE, styles: RANGE_STYLES },
    { varbit: VarbitID.PRAYER_MYSTICWILL, type: XpDropStyle.MAGE, styles: MAGE_STYLES },
    { varbit: VarbitID.PRAYER_SUPERHUMANSTRENGTH, type: XpDropStyle.MELEE, styles: MELEE_STYLES },
    { varbit: VarbitID.PRAYER_IMPROVEDREFLEXES, type: XpDropStyle.MELEE, styles: MELEE_STYLES },
    { varbit: VarbitID.PRAYER_HAWKEYE, type: XpDropStyle.RANGE, styles: RANGE_STYLES },
    { varbit: VarbitID.PRAYER_MYSTICLORE, type: XpDropStyle.MAGE, styles: MAGE_STYLES },
    { varbit: VarbitID.PRAYER_ULTIMATESTRENGTH, type: XpDropStyle.MELEE, styles: MELEE_STYLES },
    { varbit: VarbitID.PRAYER_INCREDIBLEREFLEXES, type: XpDropStyle.MELEE, styles: MELEE_STYLES },
    { varbit: VarbitID.PRAYER_EAGLEEYE, type: XpDropStyle.RANGE, styles: RANGE_STYLES },
    { varbit: VarbitID.PRAYER_MYSTICMIGHT, type: XpDropStyle.MAGE, styles: MAGE_STYLES },
    { varbit: VarbitID.PRAYER_DEADEYE, type: XpDropStyle.RANGE, styles: RANGE_STYLES },
    { varbit: VarbitID.PRAYER_MYSTICVIGOUR, type: XpDropStyle.MAGE, styles: MAGE_STYLES },
    { varbit: VarbitID.PRAYER_CHIVALRY, type: XpDropStyle.MELEE, styles: MELEE_STYLES },
    { varbit: VarbitID.PRAYER_PIETY, type: XpDropStyle.MELEE, styles: MELEE_STYLES },
    { varbit: VarbitID.PRAYER_RIGOUR, type: XpDropStyle.RANGE, styles: RANGE_STYLES },
    { varbit: VarbitID.PRAYER_AUGURY, type: XpDropStyle.MAGE, styles: MAGE_STYLES },
    { varbit: VarbitID.PRAYER_ANCIENT_STRENGTH, type: XpDropStyle.MELEE, styles: MELEE_STYLES },
    { varbit: VarbitID.PRAYER_ANCIENT_SIGHT, type: XpDropStyle.RANGE, styles: RANGE_STYLES },
    { varbit: VarbitID.PRAYER_ANCIENT_WILL, type: XpDropStyle.MAGE, styles: MAGE_STYLES },
    { varbit: VarbitID.PRAYER_TRINITAS, type: XpDropStyle.DEFAULT, styles: [] },
    { varbit: VarbitID.PRAYER_DECIMATE, type: XpDropStyle.MELEE, styles: MELEE_STYLES },
    { varbit: VarbitID.PRAYER_ANNIHILATE, type: XpDropStyle.RANGE, styles: RANGE_STYLES },
    { varbit: VarbitID.PRAYER_VAPORISE, type: XpDropStyle.MAGE, styles: MAGE_STYLES },
    { varbit: VarbitID.PRAYER_INTENSIFY, type: XpDropStyle.DEFAULT, styles: [] },
];

/**
 * Customizable XP Drops (l2-'s Plugin Hub plugin, commit 3835071): XP drops and an XP tracker
 * drawn by the client instead of the game's interface, each fully configurable, with the hit
 * each Hitpoints drop predicts. The hit divides by the Hitpoints XP rate the server sends
 * (world x league), so it is right on any XP rate. Not ported: the Party section, the overlay
 * priorities, icon overrides (resource packs) and fake XP drops.
 */
export class CustomXpDropsPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Customizable XP drops",
        description: "Allows one to use fully customizable xp drops independent of the in-game ones",
        tags: ["experience", "xp", "drops", "predicted", "hit", "tracker", "overlay"],
        enabledByDefault: false,
        configKey: "customizablexpdrops",
    };

    static config = CustomXpDropsConfig;

    private readonly configManager = inject(ConfigManager);
    readonly config = this.configManager.getConfig(CustomXpDropsConfig);
    private readonly osrsClient: OsrsClient;
    private readonly client: Client;
    private readonly pluginManager: PluginManager | undefined;
    readonly state = new XpDropState();
    readonly dropOverlay: XpDropOverlay;
    readonly trackerOverlay: XpTrackerOverlay;
    /** Current XP by skill, seeded on mid-session enable and reset on login or hop. */
    readonly skillXp: number[] = new Array(SKILL_IDS.length).fill(0);
    private filteredSkills = new Set<string>();
    private filteredSkillsPredictedHits = new Set<string>();
    private xpModifiers = new Map<number, number>();
    private lastTarget?: TargetActor;
    /** Gains since the last client tick. */
    private readonly gains: { skill: SkillId; experience: number }[] = [];
    private tick = 0;
    /** Overridable wall clock. */
    now: () => number = () => Date.now();

    constructor(osrsClient?: OsrsClient, client?: Client) {
        super();
        this.osrsClient = osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.client = client ?? new ClientImpl(this.osrsClient);
        let manager: PluginManager | undefined;
        try {
            manager = inject(PluginManager);
        } catch {
            manager = undefined;
        }
        this.pluginManager = manager;
        this.dropOverlay = new XpDropOverlay(this);
        this.trackerOverlay = new XpTrackerOverlay(this);
    }

    widgetOverlays() {
        return [this.dropOverlay, this.trackerOverlay];
    }

    protected async startUp(): Promise<void> {
        this.state.reset();
        this.gains.length = 0;
        this.lastTarget = undefined;
        this.skillXp.fill(0);
        const getStatXp = this.osrsClient.cs2Vm?.context?.getStatXp;
        if (this.isLoggedIn() && getStatXp) {
            for (const skill of SKILL_IDS) {
                const xp = getStatXp(skill);
                if (Number.isFinite(xp) && xp >= 0) this.skillXp[skill] = xp;
            }
        }
        this.readFilters();
        this.setXpTrackerHidden(this.config.useXpTracker() === true && this.config.xpTrackerHideVanilla() === true);
    }

    protected async shutDown(): Promise<void> {
        this.state.reset();
        this.setXpTrackerHidden(false);
    }

    private readFilters(): void {
        this.filteredSkills = parseSkillFilter(String(this.config.skillsToFilter() ?? ""));
        this.filteredSkillsPredictedHits = parseSkillFilter(String(this.config.skillsToFilterForPredictedHits() ?? ""));
        this.xpModifiers = parseXpModifiers(String(this.config.predictedHitModifiers() ?? ""));
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== CustomXpDropsConfig.group) return;
        this.readFilters();
        const key = event.getKey();
        if (key === "useXpTracker" || key === "xpTrackerHideVanilla") {
            this.setXpTrackerHidden(this.config.useXpTracker() === true && this.config.xpTrackerHideVanilla() === true);
        }
    }

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        if (state === GameState.LOGIN_SCREEN || state === GameState.HOPPING) {
            this.skillXp.fill(0);
            this.state.reset();
            this.gains.length = 0;
            this.lastTarget = undefined;
        }
        if (state === GameState.LOGGED_IN) this.state.lastSkillSetMillis = this.now();
    }

    onGameTick(): void {
        this.tick++;
    }

    onStatChanged(event: StatChanged): void {
        const skill = event.getSkill();
        if (!SKILL_IDS.includes(skill)) return;
        const xp = event.getXp();
        const previous = this.skillXp[skill];
        this.skillXp[skill] = xp;
        if (!(previous > 0) || !(xp - previous > 0)) return;
        this.gained(skill, xp - previous);
    }

    /** A skill gained XP: its drop (and hit) is made on the next client tick. */
    gained(skill: SkillId, experience: number): void {
        this.gains.push({ skill, experience });
    }

    /**
     * The gains since the last client tick become drops, and a Hitpoints gain against a target
     * its predicted hit. The target is read here rather than as the XP arrives: the server sends
     * the stats of an attack's first hit before the player's update that says who they attack.
     */
    private queueGains(): void {
        if (this.gains.length === 0) return;
        const current = this.currentTarget();
        if (current) this.lastTarget = current;
        const target = current ?? this.lastTarget;
        const style = this.attackStyle();
        for (const { skill, experience } of this.gains.splice(0)) {
            if (skill === SkillId.Hitpoints && target) {
                const modifier = target.type === "npc" ? this.xpModifiers.get(target.npcTypeId) ?? 1 : 1;
                this.state.hits.push({ hpXp: experience, modifier, target: current, style });
            }
            this.state.queue.push({ skill, experience, style: this.prayerStyle(skill, style), target: current });
        }
    }

    /**
     * Each 20 ms client tick: the drops move on and the new gains become drops. (The plugin uses
     * BeforeRender, which only the WebGL renderer posts here; the movement is by wall clock, so
     * the client tick moves them just as far.)
     */
    onClientTick(): void {
        if (!this.isStarted()) return;
        this.queueGains();
        this.state.update(this.now(), this.tick, this.dropSettings());
    }

    dropSettings(): DropSettings {
        const c = this.config;
        const rate = Number(this.osrsClient.hitpointsXpRate) || 1;
        return {
            isGrouped: c.isGrouped() === true,
            groupedDelay: Number(c.groupedDelay()) || 0,
            yPixelsPerSecond: Number(c.yPixelsPerSecond()) || 0,
            yDirection: c.yDirection(),
            xPixelsPerSecond: Number(c.xPixelsPerSecond()) || 0,
            xDirection: c.xDirection(),
            framesPerDrop: Number(c.framesPerDrop()) || 0,
            fadeOut: c.fadeOut() === true,
            showIcons: c.showIcons() === true,
            showPredictedHit: c.showPredictedHit() === true,
            neverGroupPredictedHit: c.neverGroupPredictedHit() === true,
            predictedHitIcon: c.predictedHitIcon(),
            filteredSkills: this.filteredSkills,
            filteredSkillsPredictedHits: this.filteredSkillsPredictedHits,
            xpTrackerSkill: c.xpTrackerSkill() as XpTrackerSkill,
            xpTrackerClientTicksToLinger: Number(c.xpTrackerClientTicksToLinger()) || 0,
            xpRate: rate * (Number(c.xpMultiplier()) || 1),
        };
    }

    /** The orb's XP drops toggle: off hides the drops and the tracker, as it hides the vanilla ones. */
    shouldDraw(): boolean {
        return this.client.getVarbitValue(EXPERIENCE_TRACKER_TOGGLE) === 1;
    }

    isLoggedIn(): boolean {
        return toRuneLiteGameState((this.osrsClient as any)?.gameState) === GameState.LOGGED_IN;
    }

    getClient(): OsrsClient {
        return this.osrsClient;
    }

    /** Hides each vanilla drop as it is sized (onScriptPreFired XPDROPS_SETDROPSIZE). */
    onScriptPreFired(scriptId: number, vm?: Cs2Vm): void {
        if (!this.isStarted() || scriptId !== XPDROPS_SETDROPSIZE || !vm) return;
        if (this.config.useCustomizableXpDrops() !== true || this.config.xpDropsHideVanilla() !== true) return;
        const uid = vm.intStack[vm.intStackSize - 4];
        const manager = this.osrsClient.widgetManager;
        const widget = manager?.getWidgetByUid(uid);
        if (manager && widget) setHidden(manager, widget, true);
    }

    /** The vanilla tracker shows itself again whenever its script runs (onScriptPostFired). */
    onScriptFinished(scriptId: number): void {
        if (!this.isStarted() || scriptId !== XP_TRACKER_SCRIPT_ID) return;
        if (this.config.useXpTracker() === true && this.config.xpTrackerHideVanilla() === true) this.setXpTrackerHidden(true);
    }

    private setXpTrackerHidden(hidden: boolean): void {
        const manager = this.osrsClient?.widgetManager;
        const tracker = manager?.getWidgetByUid(XP_TRACKER_WIDGET);
        if (manager && tracker) setHidden(manager, tracker, hidden);
    }

    /** What the local player is interacting with, if anything. */
    currentTarget(): TargetActor | undefined {
        const client = this.osrsClient;
        const index = client.playerEcs?.getIndexForServerId(client.controlledPlayerServerId | 0);
        if (index === undefined) return undefined;
        const decoded = decodeInteractionIndex(client.playerEcs.getInteractionIndex(index));
        if (!decoded) return undefined;
        if (decoded.type === "player") return { type: "player", serverId: decoded.id | 0, npcTypeId: -1 };
        const ecsId = client.npcEcs.getEcsIdForServer(decoded.id | 0);
        if (ecsId === undefined) return undefined;
        return { type: "npc", serverId: decoded.id | 0, npcTypeId: client.npcEcs.getNpcTypeId(ecsId) | 0 };
    }

    /** The equipped weapon's current attack style (RuneLite's AttackStylesPlugin lookup). */
    attackStyle(): AttackStyle {
        const category = this.client.getVarbitValue(VarbitID.COMBAT_WEAPON_CATEGORY);
        const index = this.client.getVarpValue(VarPlayerID.COM_MODE);
        const castingMode = this.client.getVarbitValue(VarbitID.AUTOCAST_DEFMODE);
        const styles = this.attackStylesFor(category);
        let style = index >= 0 && index < styles.length ? styles[index] ?? AttackStyle.OTHER : AttackStyle.OTHER;
        if (style === AttackStyle.CASTING && castingMode === 1) style = AttackStyle.DEFENSIVE_CASTING;
        return style;
    }

    private attackStylesFor(category: number): (AttackStyle | undefined)[] {
        const styleEnumId = this.client.getEnum(WEAPON_STYLES_ENUM)?.getIntValue(category) ?? -1;
        if (styleEnumId === -1) {
            if (category === 22) {
                // Blue moon spear
                return [AttackStyle.ACCURATE, AttackStyle.AGGRESSIVE, undefined, AttackStyle.DEFENSIVE,
                    AttackStyle.CASTING, AttackStyle.DEFENSIVE_CASTING];
            }
            if (category === 30) {
                // Partisan
                return [AttackStyle.ACCURATE, AttackStyle.AGGRESSIVE, AttackStyle.AGGRESSIVE, AttackStyle.DEFENSIVE];
            }
            return [];
        }
        const structs = this.client.getEnum(styleEnumId)?.getIntVals() ?? [];
        const loader = this.osrsClient.loaderFactory?.getStructTypeLoader?.();
        return structs.map((structId, i) => {
            const name = loader?.load(structId)?.params?.get(ATTACK_STYLE_NAME_PARAM);
            const style = (AttackStyle as Record<string, string>)[String(name ?? "").toUpperCase()] as AttackStyle | undefined;
            if (!style || style === AttackStyle.OTHER) return undefined;
            // "Defensive" is also Defensive casting: the sixth slot, and a powered staff's fourth.
            if (style === AttackStyle.DEFENSIVE && (i === 5 || (i === 3 && category === 24))) return AttackStyle.DEFENSIVE_CASTING;
            return style;
        });
    }

    /** The colour a drop takes from the offensive prayer up (matchPrayerStyle). */
    prayerStyle(skill: SkillId, attackStyle: AttackStyle): XpDropStyle {
        const prayer = XP_PRAYERS.find((p) => this.client.getVarbitValue(p.varbit) === 1);
        if (!prayer) return XpDropStyle.DEFAULT;
        if (prayer.styles.includes(attackStyle) && ATTACK_STYLE_SKILLS[attackStyle].includes(skill)) return prayer.type;
        // A spell cast by hand with another style's weapon.
        if (skill === SkillId.Magic && prayer.type === XpDropStyle.MAGE) return XpDropStyle.MAGE;
        if (skill === SkillId.Magic && prayer.type === XpDropStyle.MELEE
            && this.osrsClient.equipment?.getSlot(EquipmentDisplaySlot.WEAPON)?.itemId === VOIDWAKER) {
            return XpDropStyle.MELEE;
        }
        // Trinitas and Intensify boost all three styles.
        if (prayer.varbit === VarbitID.PRAYER_TRINITAS || prayer.varbit === VarbitID.PRAYER_INTENSIFY) {
            if (skill === SkillId.Attack || skill === SkillId.Strength || skill === SkillId.Defence) return XpDropStyle.MELEE;
            if (skill === SkillId.Ranged) return XpDropStyle.RANGE;
            if (skill === SkillId.Magic) return XpDropStyle.MAGE;
        }
        return XpDropStyle.DEFAULT;
    }

    /** The tracker's XP: a skill's, or the total over every skill. */
    trackerXp(skill: number): number {
        if (skill === OVERALL) return this.skillXp.reduce((total, xp) => total + xp, 0);
        return this.skillXp[skill] ?? 0;
    }

    /** The tracker's progress bar range: the XP Tracker's goals when it runs, else this level's. */
    trackerGoals(skill: SkillId): { start: number; end: number } {
        const tracker = this.pluginManager?.getPlugin(XpTrackerPlugin);
        if (tracker?.isStarted() && tracker.getSkillSnapshot(skill)) {
            return { start: tracker.getStartGoalXp(skill), end: tracker.getEndGoalXp(skill) };
        }
        return levelGoals(this.skillXp[skill] ?? 0);
    }

    openSettings(): void {
        openConfiguration(CustomXpDropsPlugin);
    }
}
