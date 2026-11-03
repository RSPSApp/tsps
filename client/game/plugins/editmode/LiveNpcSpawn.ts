import { send, isSocketOpen } from "../../../network/serverConnection/connection/send";
import { subscribePluginMessages } from "../../../network/serverConnection/domain/pluginMessages";
import type { NpcEcs } from "../../ecs/NpcEcs";
import { npcSpawnKey, parseCustomNpcSpawnSnapshot, type BrowserHostNpcSpawn } from "./hostProtocol/npcSpawnMessage";
import type { EditModeSelection } from "./types";

const NPC_EDITOR_CHANNEL = "npc-editor";
let nextRequest = 0;

/** Resolve an exact live instance through the game connection, including hosted worlds. */
export function requestLiveNpcSpawn(selection: EditModeSelection): Promise<BrowserHostNpcSpawn | undefined> {
    if (!isSocketOpen() || selection.npcServerId === undefined) return Promise.resolve(undefined);
    const request = ++nextRequest;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            unsubscribe();
            reject(new Error("The NPC spawn lookup timed out. Select the NPC again."));
        }, 5000);
        const unsubscribe = subscribePluginMessages(({ channel, data }) => {
            if (channel !== NPC_EDITOR_CHANNEL || (data.request !== request && data.type !== "unavailable")) return;
            clearTimeout(timer);
            unsubscribe();
            try {
                resolve(data.spawn === undefined ? undefined : parseCustomNpcSpawnSnapshot([data.spawn])[0]);
            } catch (error) {
                reject(error);
            }
        });
        send({ type: "plugin_message", payload: { channel: NPC_EDITOR_CHANNEL, data: {
            type: "spawn", request, index: selection.npcServerId, id: selection.locId,
            x: selection.tileX, y: selection.tileY, plane: selection.plane,
        } } });
    });
}

/** Live identities and editor-only undo previews must never share reusable server indices. */
export class LiveNpcSpawns {
    private readonly live = new Map<number, { spawn: BrowserHostNpcSpawn; ecsId: number }>();
    private readonly hidden = new Map<string, BrowserHostNpcSpawn>();
    private readonly restored = new Map<string, number>();

    constructor(
        private readonly ecs: NpcEcs,
        private readonly getTile: (ecsId: number) => { x: number; y: number } | undefined,
        private readonly spawnPreview: (spawn: BrowserHostNpcSpawn) => number | undefined,
        private readonly despawn: (serverId: number) => void,
    ) {
        ecs.mutationListeners.add((event) => {
            if (event.kind !== "despawn" && event.kind !== "composition") return;
            for (const [serverId, entry] of this.live) {
                if (entry.ecsId === event.index) this.live.delete(serverId);
            }
            for (const [key, serverId] of this.restored) {
                if (ecs.getEcsIdForServer(serverId) === event.index) this.restored.delete(key);
            }
        });
    }

    async resolve(selection: EditModeSelection): Promise<BrowserHostNpcSpawn | undefined> {
        const serverId = selection.npcServerId;
        if (serverId === undefined) return undefined;
        const ecsId = this.ecs.getEcsIdForServer(serverId);
        if (ecsId === undefined) return undefined;
        let stale = false;
        const onMutation = (event: import("../../ecs/ActorMutation").ActorMutation) => {
            if (event.index === ecsId && (event.kind === "despawn" || event.kind === "spawn" ||
                event.kind === "composition")) stale = true;
        };
        this.ecs.mutationListeners.add(onMutation);
        try {
            const spawn = await requestLiveNpcSpawn(selection);
            if (!spawn || stale || this.ecs.getEcsIdForServer(serverId) !== ecsId ||
                this.ecs.getNpcTypeId(ecsId) !== selection.locId) return undefined;
            const tile = this.getTile(ecsId);
            if (!tile || tile.x !== selection.tileX || tile.y !== selection.tileY ||
                this.ecs.getLevel(ecsId) !== selection.plane) return undefined;
            this.live.set(serverId, { spawn, ecsId });
            return spawn;
        } finally {
            this.ecs.mutationListeners.delete(onMutation);
        }
    }

    source(serverId: number): BrowserHostNpcSpawn | undefined {
        for (const [key, restoredId] of this.restored) {
            if (restoredId === serverId && this.ecs.getEcsIdForServer(serverId) !== undefined) return this.hidden.get(key);
        }
        return undefined;
    }

    hide(spawn: BrowserHostNpcSpawn): void {
        const key = npcSpawnKey(spawn);
        const restoredId = this.restored.get(key);
        if (restoredId !== undefined) this.despawn(restoredId);
        this.restored.delete(key);
        for (const [serverId, entry] of this.live) {
            if (npcSpawnKey(entry.spawn) !== key || this.ecs.getEcsIdForServer(serverId) !== entry.ecsId) continue;
            this.hidden.set(key, entry.spawn);
            this.live.delete(serverId);
            this.despawn(serverId);
        }
    }

    show(spawn: BrowserHostNpcSpawn): void {
        const key = npcSpawnKey(spawn);
        const source = this.hidden.get(key);
        const restoredId = this.restored.get(key);
        if (!source || (restoredId !== undefined && this.ecs.getEcsIdForServer(restoredId) !== undefined)) return;
        const serverId = this.spawnPreview(source);
        if (serverId !== undefined) this.restored.set(key, serverId);
    }
}
