import * as VarbitID from "@runelite/api/gameval/VarbitID";
import * as VarPlayerID from "@runelite/api/gameval/VarPlayerID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { NpcOutline, WidgetOverlay } from "../ClientPluginManager";
import type { OsrsClient } from "../../OsrsClient";
import { AssistantPanelOverlay } from "../skillassistants/AssistantPanelOverlay";
import { SlayerTrackerConfig } from "./SlayerTrackerConfig";

const SLAYER_BOSS_TASK = 98;
const NPC_SLAYER_TASK_PARAM = 50;
// slayer_task gameval table: `id` and `name_uppercase` columns in the cache DB rows.
const SLAYER_TASK_TABLE_ID = 113;
const SLAYER_TASK_ID_COLUMN = 0;
const SLAYER_TASK_NAME_COLUMN = 10;
const ORANGE = 0xff981f;

type SlayerSnapshot = {
    count: number;
    originalCount: number;
    target: number;
    points: number;
    standardStreak: number;
    wildernessStreak: number;
};

/** Task counter, points, streaks, and visible task-target highlights from Slayer varps. */
export class SlayerTrackerPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Slayer Tracker",
        description: "Show the current Slayer task, remaining kills, points, and task streaks.",
        tags: ["slayer", "combat", "overlay", "npc highlight"],
        enabledByDefault: false,
        configKey: "slayertrackerplugin",
    };

    static config = SlayerTrackerConfig;

    private readonly client: OsrsClient;
    private readonly config = inject(ConfigManager).getConfig(SlayerTrackerConfig);
    private snapshot: SlayerSnapshot = {
        count: 0,
        originalCount: 0,
        target: 0,
        points: 0,
        standardStreak: 0,
        wildernessStreak: 0,
    };
    private targetNpcs: { ecsId: number; serverId: number; name: string }[] = [];
    private readonly taskNames = new Map<number, string | null>();
    readonly widgetOverlay: WidgetOverlay;

    constructor(client?: OsrsClient) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.widgetOverlay = new AssistantPanelOverlay(
            "SlayerTrackerOverlay",
            "BOTTOM_LEFT",
            "Slayer tracker",
            () => this.rows(),
        );
    }

    protected async startUp(): Promise<void> {
        this.refresh();
    }

    protected async shutDown(): Promise<void> {
        this.targetNpcs = [];
        this.snapshot = { count: 0, originalCount: 0, target: 0, points: 0, standardStreak: 0, wildernessStreak: 0 };
    }

    onGameTick(): void {
        this.refresh();
    }

    npcOutlines(): NpcOutline[] {
        if (!this.isStarted() || !this.config.highlightTargets() || this.snapshot.count <= 0) return [];
        return this.targetNpcs.map(({ ecsId, serverId }) => ({
            ecsId,
            serverId,
            color: ORANGE,
            alpha: 0.82,
            width: 2,
        }));
    }

    private refresh(): void {
        const vars = this.client.varManager;
        if (!vars) return;
        if (!this.client.isLoggedIn()) {
            this.targetNpcs = [];
            this.snapshot = { count: 0, originalCount: 0, target: 0, points: 0, standardStreak: 0, wildernessStreak: 0 };
            return;
        }
        this.snapshot = {
            count: Math.max(0, vars.getVarp(VarPlayerID.SLAYER_COUNT) | 0),
            originalCount: Math.max(0, vars.getVarp(VarPlayerID.SLAYER_COUNT_ORIGINAL) | 0),
            target: vars.getVarp(VarPlayerID.SLAYER_TARGET) | 0,
            points: Math.max(0, vars.getVarbit(VarbitID.SLAYER_POINTS) | 0),
            standardStreak: Math.max(0, vars.getVarbit(VarbitID.SLAYER_TASKS_COMPLETED) | 0),
            wildernessStreak: Math.max(0, vars.getVarbit(VarbitID.SLAYER_WILDERNESS_TASKS_COMPLETED) | 0),
        };
        this.targetNpcs = this.findTargetNpcs();
    }

    private findTargetNpcs(): { ecsId: number; serverId: number; name: string }[] {
        const { npcEcs, npcTypeLoader, varManager } = this.client;
        const { target, count } = this.snapshot;
        if (!this.isStarted() || !this.config.highlightTargets() || count <= 0 || target <= 0 || target === SLAYER_BOSS_TASK
            || !npcEcs || !npcTypeLoader || !varManager) return [];

        const matches: { ecsId: number; serverId: number; name: string }[] = [];
        for (const ecsId of npcEcs.getAllActiveIds()) {
            if (!npcEcs.isLinked(ecsId)) continue;
            const rawType = npcTypeLoader.load(npcEcs.getNpcTypeId(ecsId) | 0);
            if (!rawType) continue;
            let type = rawType;
            if (rawType.transforms?.length) {
                const transformed = rawType.transform(varManager, npcTypeLoader);
                if (!transformed) continue;
                type = transformed;
            }
            if (type.params?.get(NPC_SLAYER_TASK_PARAM) !== target
                && rawType.params?.get(NPC_SLAYER_TASK_PARAM) !== target) continue;
            matches.push({ ecsId, serverId: npcEcs.getServerId(ecsId), name: type.name });
        }
        return matches;
    }

    private rows(): string[] {
        if (!this.isStarted() || !this.client.isLoggedIn()) return [];
        const { count, originalCount, target, points, standardStreak, wildernessStreak } = this.snapshot;
        const rows: string[] = [];
        if (count > 0 && target > 0) {
            const name = target === SLAYER_BOSS_TASK
                ? "Boss task"
                : this.taskName(target) ?? `Task #${target}`;
            rows.push(`${name}: ${count.toLocaleString()} remaining`);
            if (originalCount > count) rows.push(`Completed this task: ${(originalCount - count).toLocaleString()}`);
        } else {
            rows.push("No active task");
        }
        if (this.config.showPoints()) rows.push(`Points: ${points.toLocaleString()}`);
        if (this.config.showStreak()) {
            rows.push(`Task streak: ${standardStreak.toLocaleString()}`);
            rows.push(`Wilderness streak: ${wildernessStreak.toLocaleString()}`);
        }
        return rows;
    }

    private taskName(target: number): string | undefined {
        if (this.taskNames.has(target)) return this.taskNames.get(target) ?? undefined;

        const rows = this.client.cs2Vm?.context?.dbRepository?.getRows(SLAYER_TASK_TABLE_ID) ?? [];
        const row = rows.find(candidate => candidate.getColumn(SLAYER_TASK_ID_COLUMN)?.values[0] === target);
        const value = row?.getColumn(SLAYER_TASK_NAME_COLUMN)?.values[0];
        const name = typeof value === "string" && value.trim() ? value.trim() : null;
        this.taskNames.set(target, name);
        return name ?? undefined;
    }
}
