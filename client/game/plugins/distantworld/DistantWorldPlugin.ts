import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { GameState } from "@runelite/api/GameState";
import type { ConfigChanged, GameStateChanged, PluginMessage } from "@runelite/api/events";
import { ClientState } from "../../ClientState";
import { getMousePos } from "../../InputManager";
import type { OsrsClient } from "../../OsrsClient";
import type { WebGLOsrsRenderer } from "../../../render/WebGLOsrsRenderer";
import { send } from "../../../network/serverConnection/connection/send";
import { MenuTargetType } from "../../../rs/MenuEntry";
import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import type { MenuTransformContext } from "../../../ui/menu/menuTransforms";
import { menuAction, MENU_ACTION_DEPRIORITIZE_OFFSET } from "../../../ui/menu/MenuAction";
import type { MenuActionData } from "../../../ui/menu/menuEvents";
import { MenuOpcode } from "../../../ui/menu/MenuState";
import { osrsTargetLabel } from "../../../ui/menu/MenuBridge";
import { MINIMENU_BLOCK_ENTITY, MINIMENU_BLOCK_EXAMINE } from "../../../ui/menu/minimenuFilters";
import { getNpcMenuOptions } from "../../menu/WorldMenuBuilder";
import type { CosmeticNpc, ScenerySettings } from "../ScenePresentation";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { WorkerSearchBackend } from "../shortestpath/pathfinder/WorkerSearchBackend";
import { getEffectiveNpcType } from "../../../render/webgpu/actors/actorPacking";
import { DistantWorldConfig } from "./DistantWorldConfig";
import { DistantWorldState, MAX_DISTANT_SPAWNS, cosmeticActor, distanceTo, idleFrame, type DistantSpawn, type Tile } from "./DistantWorldState";
import { DistantApproach, type ApproachIntent } from "./DistantApproach";
import { createDistantWorldNavigationButton } from "./DistantWorldPanel";
import { DistantNpcMotion } from "./DistantNpcMotion";

const CHANNEL = "distant-world";
const MAX_POSE_UPDATES = 64;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
type ConfigKey = keyof typeof DistantWorldConfig.items;
type ClickFeedbackHost = Pick<WebGLOsrsRenderer, "spawnClickCross" | "toGLClickXY">;

/** Optional scenery and spawn previews. Server NPCs remain the sole interaction targets. */
export class DistantWorldPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Distant World", description: "Stream distant scenery and animated NPC spawn previews",
        tags: ["draw distance", "scenery", "npc", "lod"], enabledByDefault: false, configKey: "distantworldplugin",
    };
    static config = DistantWorldConfig;
    readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    private readonly manager = inject(ConfigManager);
    readonly config = this.manager.getConfig(DistantWorldConfig);
    private readonly toolbar = inject(ClientToolbar);
    private navigation?: NavigationButton;
    private inputCanvas?: HTMLCanvasElement;
    readonly world = new DistantWorldState();
    private backend?: WorkerSearchBackend;
    private nonce = 0;
    private catalogRequest = -1;
    private resolveRequest = -1;
    private nextCatalog = 0;
    private catalogAt = 0;
    private serverUnavailable = false;
    private nextTick = 0;
    private nextBudget = 0;
    private lastGrowth = 0;
    private pressure = 0;
    private npcPressure = 0;
    private lastPreviewGrowth = 0;
    private context = "";
    private actors: CosmeticNpc[] = [];
    private effective = 128;
    private previewLimit = 256;
    private eligible = 0;
    private readonly poses = new Map<string, { seqId: number; frameId: number }>();
    private readonly motion = new DistantNpcMotion();
    private poseCursor = 0;
    private poseInterval = 100;
    private status = "Scenery enabled. Waiting for public spawn data.";
    private readonly listeners = new Set<() => void>();
    private snapshot = { status: this.status, distance: this.effective, previews: 0, eligible: 0, catalog: 0,
        previewLimit: this.previewLimit, truncated: false, gpuMiB: 0, sceneryOwner: undefined as string | undefined, version: 0 };
    private dispatching = false;
    readonly approach = new DistantApproach({
        backend: () => this.backend ??= new WorkerSearchBackend(new URL(`${process.env.PUBLIC_URL || ""}/shortestpath/collision-map.zip`, window.location.href).href),
        position: () => this.player(),
        walk: (x, y) => this.client.routePlayerTo(x, y, this.client.runMode, true),
        stop: () => this.client.stopPlayerWalking(),
        resolve: intent => this.resolve(intent),
        status: text => { this.status = text; this.publish(); }, now: () => performance.now(),
    });
    private readonly cancelInput = (event: Event) => {
        if (!this.approach.intent) return;
        if (event.type === "keydown") {
            if (!["Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes((event as KeyboardEvent).key)) return;
        } else {
            const pointer = event as PointerEvent;
            if ((pointer.button ?? 0) !== 0 || this.client.menuOpen || (this.inputCanvas as any)?.__ui?.menu?.open) return;
            // A pointer press precedes native widget dispatch. Let that dispatch
            // decide whether a UI operation replaces the approach, such as bank
            // access, or merely changes a setting such as the run toggle.
            const [x, y] = this.inputCanvas && Number.isFinite(pointer.clientX) && Number.isFinite(pointer.clientY)
                ? getMousePos(this.inputCanvas, pointer)
                : [this.client.inputManager.getInteractionMouseX(), this.client.inputManager.getInteractionMouseY()];
            if (this.client.isPointOverWidget(x, y)) return;
        }
        this.approach.cancel("Approach cancelled by input.", true);
    };
    readonly widgetOverlay: WidgetOverlay = new RangeOverlay(this);

    protected async startUp(): Promise<void> {
        this.effective = 128; this.context = ""; this.nextCatalog = 0; this.catalogAt = 0; this.serverUnavailable = false;
        this.previewLimit = this.requestedPreviewLimit(); this.pressure = this.npcPressure = 0; this.poseCursor = 0;
        this.world.clear(); this.world.supported = true;
        this.navigation = createDistantWorldNavigationButton(this);
        this.toolbar.addNavigation(this.navigation);
        this.bindCanvas();
        window.addEventListener("keydown", this.cancelInput);
    }
    protected async shutDown(): Promise<void> {
        this.reset(); this.backend?.dispose(); this.backend = undefined;
        if (this.navigation) this.toolbar.removeNavigation(this.navigation);
        this.navigation = undefined;
        this.inputCanvas?.removeEventListener("pointerdown", this.cancelInput);
        this.inputCanvas = undefined;
        window.removeEventListener("keydown", this.cancelInput);
    }
    private bindCanvas(): void {
        const canvas = this.client.renderer?.canvas;
        if (canvas === this.inputCanvas) return;
        this.inputCanvas?.removeEventListener("pointerdown", this.cancelInput);
        this.inputCanvas = canvas;
        canvas?.addEventListener("pointerdown", this.cancelInput);
    }
    subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    getState() { return this.snapshot; }
    setConfig(key: ConfigKey, value: unknown): void {
        this.manager.setConfiguration(DistantWorldConfig.group, key, String(value));
        if (key === "npcLimit") this.previewLimit = this.requestedPreviewLimit();
        this.actors = []; this.nextCatalog = 0; this.publish();
    }
    private requestedPreviewLimit(): number { return Math.trunc(clamp(Number(this.config.npcLimit()), 16, MAX_DISTANT_SPAWNS)); }
    private sceneryOwner(): string | undefined {
        if (this.client.clientPlugins?.hdEnabled?.()) return "117 HD";
        if (this.client.clientPlugins?.gpuSettings?.()) return "GPU";
        return undefined;
    }
    private previewDistance(): number {
        if (!this.sceneryOwner()) return this.effective;
        const renderer = this.client.renderer;
        return clamp(renderer?.resolveEffectiveRenderDistanceTiles?.(renderer.stats?.frameCount ?? 0)
            ?? this.client.clientPlugins.gpuSettings()?.drawDistance ?? this.client.renderDistance, 0, 1024);
    }
    private publish(): void {
        this.snapshot = { status: this.status, distance: this.previewDistance(), sceneryOwner: this.sceneryOwner(), previews: this.actors.length,
            eligible: this.eligible, catalog: this.world.spawns.length, previewLimit: this.previewLimit, truncated: this.world.truncated,
            gpuMiB: Math.round((this.client.renderer?.stats.geometryGpuBytes ?? 0) / 1048576), version: this.snapshot.version + 1 };
        this.listeners.forEach(listener => listener());
    }
    player(): Tile | undefined {
        if (!this.isStarted() || !this.client.isLoggedIn() || !ClientState.scenePositionReady || ClientState.inInstance) return;
        const id = this.client.playerEcs.getIndexForServerId(this.client.controlledPlayerServerId);
        if (id === undefined || this.client.playerEcs.getWorldViewId(id) >= 0) return;
        return { x: Math.floor(this.client.playerEcs.getX(id) / 128), y: Math.floor(this.client.playerEcs.getY(id) / 128), plane: this.client.playerEcs.getLevel(id) };
    }
    scenerySettings(): ScenerySettings | undefined {
        if (!this.player() || !this.world.supported || this.sceneryOwner()) return;
        return { drawDistance: this.effective, detailDistance: Math.max(40, this.world.viewDistance + 8) };
    }
    cosmeticNpcs(): readonly CosmeticNpc[] {
        if (!this.isStarted() || !this.player()) return [];
        const now = performance.now();
        for (const actor of this.actors) this.motion.apply(actor, now);
        return this.actors;
    }
    private reset(): void {
        this.approach.cancel(undefined, true); this.world.clear(); this.actors = []; this.eligible = 0; this.poses.clear(); this.motion.clear(); this.poseCursor = 0;
        this.catalogRequest = this.resolveRequest = -1; this.nonce++;
    }
    onGameStateChanged(event: GameStateChanged): void {
        if (event.getGameState() === GameState.LOADING || event.getGameState() === GameState.LOGGED_IN) return;
        this.reset(); this.context = ""; this.nextCatalog = 0; this.catalogAt = 0; this.serverUnavailable = false; this.world.supported = true;
    }
    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== DistantWorldConfig.group) return;
        if (!this.config.deferredActions()) this.approach.cancel("Deferred interaction disabled.", true);
        this.previewLimit = this.requestedPreviewLimit();
        this.nextCatalog = 0; this.actors = []; this.publish();
    }
    onMenuOptionClicked(action: MenuActionData): boolean {
        const opcode = action.opcode >= MENU_ACTION_DEPRIORITIZE_OFFSET
            ? action.opcode - MENU_ACTION_DEPRIORITIZE_OFFSET : action.opcode;
        const widgetOperation = [MenuOpcode.WidgetType1, MenuOpcode.WidgetType4, MenuOpcode.WidgetType5,
            MenuOpcode.CC_OP, MenuOpcode.CC_OP_LowPriority].includes(opcode);
        const runToggle = widgetOperation && /^(?:toggle|enable|disable) run$/i.test(action.option.replace(/<[^>]*>/g, "").trim());
        if (!this.dispatching && !runToggle) this.approach.cancel(undefined, true);
        return false;
    }
    onClientTick(): void {
        if (!this.isStarted()) return;
        const now = performance.now();
        if (now < this.nextTick) return;
        this.nextTick = now + 100;
        this.bindCanvas();
        const player = this.player();
        const context = player ? `${player.plane}:${player.x >> 6}:${player.y >> 6}` : "unavailable";
        if (context !== this.context) {
            const previous = this.context;
            this.context = context; this.nextCatalog = 0; this.actors = [];
            // Walking over a region boundary keeps its route. Planes and submaps cancel it.
            if (!player || previous.split(":")[0] !== context.split(":")[0]) this.reset();
        }
        if (!player) {
            const status = "Unavailable in instances, boat decks or while logged out.";
            if (this.status !== status) { this.status = status; this.publish(); }
            return;
        }
        if (now >= this.nextCatalog) {
            this.catalogRequest = ++this.nonce; this.nextCatalog = now + 3000;
            const maps = this.client.renderer?.mapManager.visibleMaps.slice(0, 1024).map(map => (map.mapX << 8) | map.mapY);
            send({ type: "plugin_message", payload: { channel: CHANNEL, data: { type: "catalog", request: this.catalogRequest, radius: this.previewDistance(), maps } } });
        }
        if (now - this.catalogAt > 8000) {
            // Do not repeatedly erase a partially received first catalog between network pages.
            if (this.world.request >= 0) this.world.clear();
            if (!this.serverUnavailable) this.status = "Scenery active. Waiting for public NPC data from the DistantWorld server plugin.";
        }
        if (now >= this.nextBudget) { this.nextBudget = now + 1000; this.budget(now); this.publish(); }
        this.buildActors(player, now);
        this.approach.tick(this.world.viewDistance);
    }
    private budget(now: number): void {
        const stats = this.client.renderer?.stats;
        const frame = stats?.frameTimeJs ?? 0;
        // Scenery memory pressure must not silently erase NPCs on otherwise fast frames.
        this.npcPressure = frame > 28 ? this.npcPressure + 1 : 0;
        if (this.npcPressure >= 3) {
            this.previewLimit = Math.max(16, Math.floor(this.previewLimit / 2)); this.poseInterval = 200;
            this.npcPressure = 0; this.lastPreviewGrowth = now;
        } else if (now - this.lastPreviewGrowth > 5000 && frame < 20) {
            this.previewLimit = Math.min(this.requestedPreviewLimit(), this.previewLimit + 32);
            this.poseInterval = 100; this.lastPreviewGrowth = now;
        }
        // External graphics plugins own distance, LOD, fog and scenery memory decisions.
        if (this.sceneryOwner()) { this.pressure = 0; return; }
        const requested = clamp(Number(this.config.distance()), 128, 1024);
        const bytes = clamp(Number(this.config.memoryBudget()), 64, 512) * 1048576;
        this.pressure = (stats?.geometryGpuBytes ?? 0) > bytes || frame > 28 ? this.pressure + 1 : 0;
        if (this.pressure >= 3) { this.effective = Math.max(96, this.effective - 64); this.pressure = 0; this.lastGrowth = now; }
        else if (now - this.lastGrowth > 5000 && frame < 20 && (stats?.geometryGpuBytes ?? 0) < bytes * .75
            && !this.client.renderer?.mapManager.loadingMapIds.size) {
            this.effective = Math.min(requested, this.effective + 32); this.lastGrowth = now;
        }
        this.effective = Math.min(this.effective, requested);
    }
    private buildActors(player: Tile, now: number): void {
        if (!this.config.npcs() || !this.world.supported || now - this.catalogAt > 8000) { this.actors = []; this.eligible = 0; this.poses.clear(); this.motion.clear(); return; }
        const maps = this.client.renderer?.mapManager.visibleMaps;
        const loaded = maps ? new Set(maps.map(map => `${map.mapX}:${map.mapY}`)) : undefined;
        const scene = this.client.sceneGeometry, canvas = this.client.renderer?.canvas;
        const sample = { x: 0, y: 0 };
        const priorityOf = (spawn: DistantSpawn) => {
            sample.x = spawn.x + .5; sample.y = spawn.y + .5;
            this.motion.position(spawn.key, now, sample);
            const { x, y } = sample;
            if (loaded && !loaded.has(`${Math.floor(x) >> 6}:${Math.floor(y) >> 6}`)) return 2;
            if (!scene || !canvas?.width || !canvas.height) return 0;
            const h = scene.tileHeight(x, y, spawn.plane);
            const foot = scene.worldToScreen(x, h, y), head = scene.worldToScreen(x, h - 6, y);
            if (!foot || !head) return 1;
            const pad = 24;
            return Math.max(foot[0], head[0]) >= -pad && Math.min(foot[0], head[0]) <= canvas.width + pad
                && Math.max(foot[1], head[1]) >= -pad && Math.min(foot[1], head[1]) <= canvas.height + pad ? 0 : 1;
        };
        const priorities = new Map<string, number>();
        const visible = this.world.visible(player, this.previewDistance(), MAX_DISTANT_SPAWNS, index => {
            const ecs = this.client.npcEcs.getEcsIdForServer(index);
            return ecs !== undefined && this.client.npcEcs.isActive(ecs) && this.client.npcEcs.isLinked(ecs);
        }, spawn => {
            const priority = priorityOf(spawn); priorities.set(spawn.key, priority); return priority;
        });
        // A walking real NPC may enter range before the next catalog response links its index.
        // Suppression may hide a preview; it never selects an interaction target.
        const live: { typeId: number; x: number; y: number; plane: number }[] = [];
        const linked = new Set([...this.world.links.values()].map(index => this.client.npcEcs.getEcsIdForServer(index)));
        for (const id of this.client.npcEcs.getServerLinkedEcsIds()) {
            if (linked.has(id) || !this.client.npcEcs.isActive(id) || this.client.npcEcs.getWorldViewId(id) >= 0) continue;
            const typeId = getEffectiveNpcType(this.client, this.client.npcEcs.getNpcTypeId(id))?.id;
            if (typeId !== undefined) live.push({ typeId, x: this.client.npcEcs.getWorldX(id) / 128, y: this.client.npcEcs.getWorldY(id) / 128, plane: this.client.npcEcs.getLevel(id) });
        }
        // Reject unloaded/off-screen bodies before asking either renderer to build a model or pose.
        const eligible = visible.filter(spawn => priorities.get(spawn.key) === 0).filter(spawn => {
            let nearest = -1, distance = Infinity;
            live.forEach((npc, index) => {
                const d = npc.typeId === spawn.typeId ? distanceTo(npc, spawn) : Infinity;
                if (d <= (spawn.radius ?? 0) + 4 && d < distance) { nearest = index; distance = d; }
            });
            if (nearest < 0) return true;
            live.splice(nearest, 1); // One real actor must not erase every nearby spawn of its type.
            return false;
        });
        this.eligible = eligible.length;
        const selected = eligible.slice(0, Math.min(this.previewLimit, this.requestedPreviewLimit()));
        const poseTime = Math.floor(now / this.poseInterval) * this.poseInterval;
        const types = new Map<number, NonNullable<ReturnType<typeof getEffectiveNpcType>>>();
        for (const spawn of selected) {
            if (types.has(spawn.typeId)) continue;
            const type = getEffectiveNpcType(this.client, spawn.typeId);
            if (!type) continue;
            types.set(spawn.typeId, type);
        }
        const flags = (plane: number, x: number, y: number): number | undefined => {
            const map = this.client.renderer?.mapManager.mapSquares.get(((x >> 6) << 8) | (y >> 6));
            const collision = map as { collisionMaps?: readonly unknown[] } | undefined;
            if (!collision?.collisionMaps?.[plane]) return undefined;
            return this.client.renderer?.getCollisionFlagAt(plane, x, y);
        };
        const groups = new Map<string, { seqId: number }>();
        const actorPoses = new Map<string, string>();
        const sequences = new Map([...types].map(([id, type]) => [id, {
            idle: type.getIdleSeqId(this.client.basTypeLoader), walk: type.getWalkSeqId(this.client.basTypeLoader),
        }]));
        const outsideLocalRange = (x: number, y: number) => Math.max(Math.abs(x - player.x), Math.abs(y - player.y)) > this.world.viewDistance + 3;
        for (const spawn of selected) {
            const type = types.get(spawn.typeId);
            if (!type) continue;
            const { idle, walk } = sequences.get(spawn.typeId)!;
            const movement = this.motion.advance(spawn, Math.max(1, type.size), walk >= 0 && walk !== idle, now, flags,
                outsideLocalRange);
            const seqId = movement.moving && walk >= 0 ? walk : idle;
            const key = `${spawn.typeId}:${seqId}`;
            groups.set(key, { seqId }); actorPoses.set(spawn.key, key);
            if (!this.poses.has(key)) this.poses.set(key, { seqId, frameId: 0 });
        }
        for (const key of this.poses.keys()) if (!groups.has(key)) this.poses.delete(key);
        // Bound animation work, not which types exist. Walking and idle actors share separate poses.
        const ids = [...groups.keys()];
        const updates = Math.min(this.poseInterval > 100 ? MAX_POSE_UPDATES / 2 : MAX_POSE_UPDATES, ids.length);
        for (let i = 0; i < updates; i++) {
            const id = ids[(this.poseCursor + i) % ids.length], { seqId } = groups.get(id)!;
            let frame = 0;
            try {
                const seq = seqId >= 0 ? this.client.seqTypeLoader.load(seqId) : undefined;
                frame = seq?.isSkeletalSeq() ? Math.floor(poseTime / 100) * 5 % Math.max(1, seq.getSkeletalDuration()) : idleFrame(seq?.frameLengths ?? [], poseTime);
            } catch {}
            this.poses.set(id, { seqId, frameId: frame });
        }
        this.poseCursor = ids.length ? (this.poseCursor + updates) % ids.length : 0;
        this.actors = selected.flatMap(spawn => {
            const type = types.get(spawn.typeId), key = actorPoses.get(spawn.key), pose = key ? this.poses.get(key) : undefined;
            if (!type || !pose) return [];
            const actor = cosmeticActor(spawn, Math.max(1, type.size), pose.seqId, pose.frameId);
            this.motion.apply(actor, now);
            return [actor];
        }).sort((a, b) => a.typeId - b.typeId || a.seqId - b.seqId || a.frameId - b.frameId);
    }
    onPluginMessage(event: PluginMessage): void {
        if (!this.isStarted() || event.channel !== CHANNEL || !this.player()) return;
        const data = event.data as Record<string, unknown>;
        if (data.type === "unavailable") {
            this.world.clear(); this.actors = []; this.eligible = 0; this.poses.clear(); this.motion.clear();
            this.serverUnavailable = true;
            this.status = "NPC previews unavailable: the connected world has not loaded the DistantWorld server plugin.";
            this.publish(); return;
        }
        if (this.world.accept(data, this.catalogRequest)) {
            this.motion.retain(this.world.spawns);
            this.serverUnavailable = false;
            this.catalogAt = performance.now();
            this.status = this.world.supported ? "Public spawn previews. Their live state is known only when in range." : "Previews are unavailable in this map.";
            if (!this.world.supported) { this.actors = []; this.approach.cancel(undefined, true); }
            this.publish(); return;
        }
        const intent = this.approach.intent;
        if (data.type !== "resolved" || data.request !== this.resolveRequest || !intent || data.key !== intent.spawn.key) return;
        if ((intent.action || intent.examine) && !this.config.deferredActions()) {
            this.approach.cancel("Deferred interaction disabled.", true); return;
        }
        const index = Number(data.index), typeId = Number(data.typeId);
        const ecsId = this.client.npcEcs.getEcsIdForServer(index);
        const player = this.player()!;
        if (!Number.isInteger(index) || index < 0 || ecsId === undefined || !this.client.npcEcs.isLinked(ecsId)
            || !this.client.npcEcs.isActive(ecsId) || getEffectiveNpcType(this.client, this.client.npcEcs.getNpcTypeId(ecsId))?.id !== typeId
            || this.client.npcEcs.getWorldViewId(ecsId) >= 0 || this.client.npcEcs.getLevel(ecsId) !== player.plane) return;
        const npcTile = { x: this.client.npcEcs.getWorldX(ecsId) / 128, y: this.client.npcEcs.getWorldY(ecsId) / 128, plane: player.plane };
        if (distanceTo(player, npcTile) > this.world.viewDistance) return;
        const type = getEffectiveNpcType(this.client, typeId);
        if (intent.action && (!type || !getNpcMenuOptions(type).some(option => option.actionIndex === intent.actionIndex && option.option === intent.action))) {
            this.approach.cancel("The real NPC no longer offers that action.", true); return;
        }
        this.approach.cancel(`Found ${intent.spawn.name}.`, true);
        if (!intent.examine && (!intent.action || intent.actionIndex === undefined)) return;
        this.dispatching = true;
        try { menuAction(0, 0, intent.examine ? MenuOpcode.ExamineNpc : MenuOpcode.NpcFirstOption + intent.actionIndex!,
            index, -1, intent.examine ? "Examine" : intent.action!, intent.spawn.name, 0, 0); }
        finally { this.dispatching = false; }
    }
    private resolve(intent: ApproachIntent): void {
        this.resolveRequest = ++this.nonce;
        send({ type: "plugin_message", payload: { channel: CHANNEL, data: { type: "resolve", request: this.resolveRequest, key: intent.spawn.key } } });
    }
    transformMenuEntries(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[] {
        if (context.surface !== "world" || !this.player() || !this.actors.length) return entries;
        const mouseX = this.client.inputManager.getInteractionMouseX(), mouseY = this.client.inputManager.getInteractionMouseY();
        const scene = this.client.sceneGeometry;
        if (!scene) return entries;
        let closest: CosmeticNpc | undefined, best = Infinity;
        for (const actor of this.actors) {
            if (!this.client.renderer?.mapManager.visibleMaps.some(map => map.mapX === Math.floor(actor.x / 64) && map.mapY === Math.floor(actor.y / 64))) continue;
            const h = scene.tileHeight(actor.x, actor.y, actor.plane);
            const foot = scene.worldToScreen(actor.x, h, actor.y);
            const head = scene.worldToScreen(actor.x, h - scene.npcHeight(actor.typeId) / 128, actor.y);
            if (!foot || !head) continue;
            const radius = clamp(Math.abs(foot[1] - head[1]) * .4, 5, 24);
            const dx = Math.abs(foot[0] - mouseX), dy = Math.max(head[1] - mouseY, mouseY - foot[1], 0);
            const d = dx * dx + dy * dy;
            if (d < radius * radius && d < best) { closest = actor; best = d; }
        }
        const spawn = this.world.spawns.find(s => s.key === closest?.key);
        if (!spawn) return entries;
        const type = getEffectiveNpcType(this.client, spawn.typeId);
        if (!type) return entries;
        const normal: SimpleMenuEntry[] = [], low: SimpleMenuEntry[] = [], examine: SimpleMenuEntry[] = [];
        const makeRow = (option: string, intent: ApproachIntent, actionIndex?: number): SimpleMenuEntry => ({
            option,
            target: `${osrsTargetLabel({ option, targetName: spawn.name, targetType: MenuTargetType.NPC,
                targetId: type.id, targetLevel: type.combatLevel }, {
                localPlayerCombatLevel: ClientState.localPlayerCombatLevel, includeExamineIds: this.client.debugId,
            })}</col> (distant preview)`,
            targetType: MenuTargetType.NPC, targetId: type.id, actionIndex, cosmeticNpcKey: spawn.key,
            // NPC metadata drives native hover text. Only the custom handler may act on a preview.
            opcode: MenuOpcode.Custom,
            onClick: (gx, gy) => {
                const selected = this.config.deferredActions() ? intent : { spawn };
                // Custom preview rows bypass the native world-entry handler. Reuse
                // its cached click sprites immediately, before asynchronous routing.
                const renderer = this.client.renderer as unknown as ClickFeedbackHost & { interactionHost?: ClickFeedbackHost };
                const host = renderer?.interactionHost ?? renderer;
                const xy = gx !== undefined && gy !== undefined ? { sx: gx, sy: gy } : host?.toGLClickXY?.();
                if (xy && closest) host?.spawnClickCross?.(
                    { tileX: Math.floor(closest.x), tileY: Math.floor(closest.y), plane: closest.plane },
                    xy, selected.action || selected.examine ? "red" : "yellow",
                );
                void this.approach.begin(selected);
            },
        });
        if (this.client.minimenuBlockModes?.[MINIMENU_BLOCK_ENTITY] !== 0) {
            // Display order matches the world menu: Attack, then cache slots 0..4.
            const options = getNpcMenuOptions(type).sort((a, b) => Number(b.isAttack) - Number(a.isAttack) || a.actionIndex - b.actionIndex);
            for (const { option, actionIndex, isAttack } of options) {
                if (isAttack && ClientState.npcAttackOption === 3) continue;
                const deprioritized = isAttack
                    ? ClientState.npcAttackOption === 1 || ClientState.npcAttackOption === 0 && type.combatLevel > ClientState.localPlayerCombatLevel
                    : type.isFollower && ClientState.followerOpsLowPriority;
                const row = makeRow(option, { spawn, action: option, actionIndex }, actionIndex);
                if (deprioritized) row.deprioritized = true;
                (deprioritized ? low : normal).push(row);
            }
        }
        if (this.client.minimenuBlockModes?.[MINIMENU_BLOCK_EXAMINE] !== 0) {
            examine.push(makeRow("Examine", { spawn, examine: true }));
        }
        const bottom = entries.findIndex(row => row.deprioritized || (row.opcode ?? 0) >= 1000 || row.option === "Examine" || row.option === "Cancel");
        const split = bottom < 0 ? entries.length : bottom;
        return [...normal, ...entries.slice(0, split), ...low, ...examine, ...entries.slice(split)];
    }
}

/** The server reports a square NPC update boundary. This is not a simulation boundary. */
class RangeOverlay implements WidgetOverlay {
    readonly drawBelowWidgets = true;
    private segments: [number, number][][] = [];
    constructor(private readonly plugin: DistantWorldPlugin) {}
    signature(): string {
        this.segments = [];
        const player = this.plugin.player();
        if (!player || !this.plugin.config.showRange() || !this.plugin.world.supported || this.plugin.world.request < 0) return "";
        const r = this.plugin.world.viewDistance, x = player.x, y = player.y, scene = this.plugin.client.sceneGeometry;
        if (!scene) return "";
        const corners = [[x - r, y - r], [x + r + 1, y - r], [x + r + 1, y + r + 1], [x - r, y + r + 1]];
        for (let edge = 0; edge < 4; edge++) {
            const a = corners[edge], b = corners[(edge + 1) % 4];
            let previous: [number, number] | undefined;
            for (let step = 0; step <= 2 * r + 1; step++) {
                const t = step / (2 * r + 1), cx = a[0] + (b[0] - a[0]) * t, cy = a[1] + (b[1] - a[1]) * t;
                const p = scene.worldToScreen(cx, scene.tileHeight(cx, cy, player.plane) - .02, cy);
                if (p && previous) this.segments.push([previous, [p[0], p[1]]]);
                previous = p ? [p[0], p[1]] : undefined;
            }
        }
        return JSON.stringify(this.segments.map(s => s.map(p => p.map(Math.round))));
    }
    draw(context: WidgetOverlayDrawContext) {
        for (const points of this.segments) context.renderer.drawPolyline(points, 1.5, [0.2, .85, 1, .65], false);
        return this.segments.map(points => ({ x: Math.min(points[0][0], points[1][0]) - 2, y: Math.min(points[0][1], points[1][1]) - 2,
            w: Math.abs(points[0][0] - points[1][0]) + 4, h: Math.abs(points[0][1] - points[1][1]) + 4 }));
    }
}
