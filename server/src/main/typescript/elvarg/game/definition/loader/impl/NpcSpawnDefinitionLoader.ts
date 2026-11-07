import { World } from "../../../World";
import { CrossFloor } from "../../../CrossFloor";
import { NpcDefinition } from "../../NpcDefinition";
import { NpcSpawnDefinition } from "../../NpcSpawnDefinition";
import { NPC } from "../../../entity/impl/npc/NPC";
import { NpcSpawnLineage } from "../../../entity/impl/npc/NpcSpawnLineage";
import { Direction } from "../../../model/Direction";
import { Location } from "../../../model/Location";
import { DefinitionLoader } from "../DefinitionLoader";
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { NpcIdentifiers } from "../../../../util/NpcIdentifiers";
import { PluginManager } from "../../../../plugins/PluginManager";
import { ServerPerf } from "../../../../util/ServerPerf";

interface RawNpcSpawnDefinition {
    /** Numeric cache id. Use `key` instead to name a constant in NpcIdentifiers. */
    id?: number;
    /**
     * Name of a constant in NpcIdentifiers (e.g. "KING_NARNODE_SHAREEN"). Resolved when
     * the world loads, so a cache update that regenerates the identifiers re-points the
     * spawn with it. Prefer this over `id` for NPCs that have a constant.
     */
    key?: string;
    name?: string;
    x: number;
    y: number;
    level: number;
    wanderRadius?: number;
    direction?: number;
    /** A spawn patch entry that removes the matching persisted spawn. */
    remove?: boolean;
}

export class NpcSpawnDefinitionLoader extends DefinitionLoader {
    public static readonly DEFINITION_TYPE = "npc_spawns";
    private static readonly DEFAULT_WANDER_RADIUS = 5;
    /** South: how live OSRS NPCs stand when nothing turns them (rsprox captures). */
    private static readonly DEFAULT_CLIENT_DIRECTION = 1;
    /**
     * A spawn's `direction` counts from south-west (0 south-west, 1 south, ... 6 north, 7
     * north-east), as the client's Direction does; this gives the server's Direction id.
     */
    private static readonly CLIENT_TO_SERVER_DIRECTION = [5, 6, 7, 3, 4, 0, 1, 2];
    /**
     * The cache's spawnDirection counts from north-west, as the game does (0 north-west,
     * 1 north, ... 6 south, 7 south-east): its default, 6, is south. This gives the spawn
     * numbering. Read the other way, every NPC without a direction faced north.
     */
    private static readonly CACHE_TO_CLIENT_DIRECTION = [5, 6, 7, 3, 4, 0, 1, 2];
    /** The spawns the last load applied, with their respawn clones. */
    private static lineage: NpcSpawnLineage | null = null;
    public static readonly LINEAGE_OWNER = "npc-spawns";
    private static readonly pendingByRegion = new Map<string, NpcSpawnDefinition[]>();
    // A surrounding 64-tile square gives ordinary wanderers time to move before entering view.
    private static readonly MAX_DEFERRED_WANDER_RADIUS = 32;

    public load(): boolean {
        const loaded = this.loadSources<RawNpcSpawnDefinition>(
            NpcSpawnDefinitionLoader.DEFINITION_TYPE
        );
        const definitions: NpcSpawnDefinition[] = [];
        let totalCandidates = 0;
        let invalid = 0;
        let unsupported = 0;
        let vetoed = 0;

        // Merge sources in priority order, applying their records in file order.
        // A later source can replace a spawn at the same tile (wander/facing),
        // and a remove marker drops the spawns recorded before it. An addition
        // after that marker survives, which is how a spawn moved onto its own
        // original tile still loads.
        const merged: Array<{ raw: RawNpcSpawnDefinition; source: string } | undefined> = [];
        const indicesByKey = new Map<string, number[]>();
        for (const source of loaded.sources) {
            totalCandidates += source.definitions.length;
            for (const raw of source.definitions) {
                const key = raw && typeof raw === "object"
                    ? NpcSpawnDefinitionLoader.spawnKey(raw)
                    : undefined;
                if (raw && typeof raw === "object" && raw.remove === true) {
                    if (key === undefined) continue;
                    for (const index of indicesByKey.get(key) ?? []) merged[index] = undefined;
                    indicesByKey.delete(key);
                    continue;
                }
                if (key !== undefined) {
                    const survivors: number[] = [];
                    for (const index of indicesByKey.get(key) ?? []) {
                        const entry = merged[index];
                        if (!entry) continue;
                        // A later source replaces the earlier records; duplicates
                        // inside one source are all kept.
                        if (entry.source !== source.name) merged[index] = undefined;
                        else survivors.push(index);
                    }
                    survivors.push(merged.length);
                    indicesByKey.set(key, survivors);
                }
                merged.push({ raw, source: source.name });
            }
        }

        for (const entry of merged) {
            if (!entry) continue;
            const { raw, source } = entry;
            const definition = this.toDefinition(raw, source);
            if (!definition) {
                invalid++;
                continue;
            }
            if (definition.getId() >= CacheDefinitions.getCounts().npcs) {
                unsupported++;
                continue;
            }
            if (PluginManager.emitCanSpawnNpc(definition.getId(), definition.getPosition()) === false) {
                vetoed++;
                continue;
            }
            definitions.push(definition);
        }

        NpcSpawnDefinition.replace(definitions);
        const applied = this.applyToWorld(definitions);
        (invalid > 0 || unsupported > 0 ? console.warn : console.debug)(
            `[npc-spawns] Loaded ${definitions.length} definitions from ` +
            `${loaded.sources.map((source) => source.name).join("+") || "none"} ` +
            `(candidates=${totalCandidates}, invalid=${invalid}, unsupported=${unsupported}, vetoed=${vetoed}, ` +
            `active=${applied}, deferred=${definitions.length - applied})`
        );
        return loaded.failures === 0;
    }

    public file(): string {
        return NpcSpawnDefinitionLoader.DEFINITION_TYPE;
    }

    /** Stable identity for spawn overrides and removals: type id plus tile and plane. */
    private static spawnKey(raw: RawNpcSpawnDefinition): string | undefined {
        const keyed = typeof raw?.key === "string" && raw.key.length > 0
            ? (NpcIdentifiers as unknown as Record<string, number | undefined>)[raw.key]
            : undefined;
        if (typeof raw?.key === "string" && raw.key.length > 0 && typeof keyed !== "number") return undefined;
        const id = Math.trunc(Number(keyed ?? raw?.id));
        const x = Math.trunc(Number(raw?.x));
        const y = Math.trunc(Number(raw?.y));
        const z = Math.trunc(Number(raw?.level));
        if (
            !Number.isFinite(id) ||
            id < 0 ||
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(z)
        ) {
            return undefined;
        }
        return `${id}:${x}:${y}:${z}`;
    }

    private toDefinition(
        raw: RawNpcSpawnDefinition,
        source: string
    ): NpcSpawnDefinition | null {
        const keyed = typeof raw?.key === "string" && raw.key.length > 0
            ? (NpcIdentifiers as unknown as Record<string, number | undefined>)[raw.key]
            : undefined;
        if (typeof raw?.key === "string" && raw.key.length > 0 && typeof keyed !== "number") {
            console.warn(`[npc-spawns] Unknown NpcIdentifiers key "${raw.key}" in ${source}`);
            return null;
        }
        const id = Math.trunc(Number(keyed ?? raw?.id));
        const x = Math.trunc(Number(raw?.x));
        const y = Math.trunc(Number(raw?.y));
        const z = Math.trunc(Number(raw?.level));
        if (
            !Number.isFinite(id) ||
            id < 0 ||
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(z)
        ) {
            return null;
        }

        const clientDirection = Number.isFinite(raw.direction)
            ? Math.trunc(raw.direction as number) & 7
            : id < CacheDefinitions.getCounts().npcs
              ? NpcSpawnDefinitionLoader.CACHE_TO_CLIENT_DIRECTION[CacheDefinitions.getNpc(id).spawnDirection & 7]
              : NpcSpawnDefinitionLoader.DEFAULT_CLIENT_DIRECTION;
        const facingId = NpcSpawnDefinitionLoader.CLIENT_TO_SERVER_DIRECTION[clientDirection];
        const radius = Number.isFinite(raw.wanderRadius)
            ? Math.max(0, Math.trunc(raw.wanderRadius as number))
            : NpcSpawnDefinitionLoader.DEFAULT_WANDER_RADIUS;
        return new NpcSpawnDefinition(
            id,
            new Location(x, y, z),
            Direction.valueOf(facingId),
            radius,
            String(raw.name ?? ""),
            source
        );
    }

    private applyToWorld(definitions: NpcSpawnDefinition[]): number {
        // A reload replaces them all, respawn clones and queued respawns included.
        NpcSpawnDefinitionLoader.lineage?.retire();
        const lineage = new NpcSpawnLineage(NpcSpawnDefinitionLoader.LINEAGE_OWNER);
        NpcSpawnDefinitionLoader.lineage = lineage;
        NpcSpawnDefinitionLoader.pendingByRegion.clear();
        let applied = 0;
        for (const definition of definitions) {
            // Wide-ranging NPCs may wander into view far from their original square.
            if ((definition.getRadius() ?? NpcSpawnDefinitionLoader.DEFAULT_WANDER_RADIUS) >
                NpcSpawnDefinitionLoader.MAX_DEFERRED_WANDER_RADIUS && NpcSpawnDefinitionLoader.spawn(definition)) {
                applied++;
                continue;
            }
            const at = definition.getPosition();
            const key = `${at.getZ()}:${at.getX() >> 6}:${at.getY() >> 6}`;
            const pending = NpcSpawnDefinitionLoader.pendingByRegion.get(key);
            if (pending) pending.push(definition);
            else NpcSpawnDefinitionLoader.pendingByRegion.set(key, [definition]);
        }

        for (const player of World.getPlayers()) {
            applied += NpcSpawnDefinitionLoader.activateNear(player.getLocation(), player.getNpcViewDistance());
            const localNpcs = player.getLocalNpcs();
            if (Array.isArray(localNpcs)) {
                localNpcs.length = 0;
            }
        }
        return applied;
    }

    /** Called for humans and bots, before login/map-square hooks and visibility updates. */
    public static activateNear(location: Location, viewDistance = 15): number {
        if (!NpcSpawnDefinitionLoader.lineage || NpcSpawnDefinitionLoader.pendingByRegion.size === 0) return 0;
        return ServerPerf.measurePhase("world.activate_npc_spawns", () => {
            let applied = 0;
            const regionX = location.getX() >> 6;
            const regionY = location.getY() >> 6;
            const radius = Math.max(1, Math.ceil((viewDistance + NpcSpawnDefinitionLoader.MAX_DEFERRED_WANDER_RADIUS) / 64));
            const levels = CrossFloor.enabled() && location.getZ() >= 0 && location.getZ() < 4
                ? Array.from({ length: location.getZ() + 1 }, (_, level) => level)
                : [location.getZ()];
            for (const level of levels) {
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dy = -radius; dy <= radius; dy++) {
                        const key = `${level}:${regionX + dx}:${regionY + dy}`;
                        const pending = NpcSpawnDefinitionLoader.pendingByRegion.get(key);
                        if (!pending) continue;
                        const remaining: NpcSpawnDefinition[] = [];
                        for (const definition of pending) {
                            const spawnPosition = definition.getPosition();
                            const activationRange = viewDistance + (definition.getRadius() ?? NpcSpawnDefinitionLoader.DEFAULT_WANDER_RADIUS);
                            if (level !== location.getZ() && Math.max(
                                Math.abs(spawnPosition.getX() - location.getX()),
                                Math.abs(spawnPosition.getY() - location.getY()),
                            ) > activationRange) {
                                remaining.push(definition);
                                continue;
                            }
                            if (NpcSpawnDefinitionLoader.spawn(definition)) applied++;
                            else remaining.push(definition);
                        }
                        if (remaining.length) NpcSpawnDefinitionLoader.pendingByRegion.set(key, remaining);
                        else NpcSpawnDefinitionLoader.pendingByRegion.delete(key);
                    }
                }
            }
            // shortcut: activated NPCs stay alive to preserve scripts and respawn timers; add sleeping only with state-safe lifecycle support.
            return applied;
        });
    }

    /**
     * Put a live world spawn back on its region's pending list, for content that stands
     * its own copy on the tile for a while (a seasonal version of the NPC). It returns
     * through activateNear, tracked as before, once onCanSpawnNpc stops vetoing it.
     */
    public static requeue(npc: NPC): boolean {
        if (!NpcSpawnDefinitionLoader.lineage || npc.getSpawnLineage() !== NpcSpawnDefinitionLoader.lineage) return false;
        // A dead or dying spawn already has its respawn queued, and that clone would not
        // ask onCanSpawnNpc: requeueing it too would bring the NPC back twice.
        if (!npc.isRegistered() || npc.isDyingFunction()) return false;
        const home = npc.getSpawnPosition();
        const definition = NpcSpawnDefinition.all().find((entry) => entry.getId() === npc.getId() && entry.getPosition().equals(home));
        if (!definition) return false;
        (npc as NPC & { __skipDefaultRespawn?: boolean }).__skipDefaultRespawn = true;
        World.getNpcs().remove(npc);
        const key = `${home.getZ()}:${home.getX() >> 6}:${home.getY() >> 6}`;
        const pending = NpcSpawnDefinitionLoader.pendingByRegion.get(key);
        if (pending) pending.push(definition);
        else NpcSpawnDefinitionLoader.pendingByRegion.set(key, [definition]);
        return true;
    }

    private static spawn(definition: NpcSpawnDefinition): boolean {
        if (World.getNpcs().isFull()) return false;
        // A content veto keeps the spawn pending: it comes back when the veto ends.
        if (PluginManager.emitCanSpawnNpc(definition.getId(), definition.getPosition()) === false) return false;
        const npc = NPC.create(definition.getId(), definition.getPosition().clone());
        npc.getMovementCoordinator().setRadius(definition.getRadius() ?? NpcSpawnDefinitionLoader.DEFAULT_WANDER_RADIUS);
        npc.setFace(definition.getFacing());
        npc.setSpawnLineage(NpcSpawnDefinitionLoader.lineage);
        const describedNpc = npc as NPC & { setDescription?(description: string): void };
        if (definition.getDescription() && describedNpc.setDescription) describedNpc.setDescription(definition.getDescription());
        return World.getNpcs().add(npc);
    }
}
