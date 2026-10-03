import { World } from "../../../World";
import { NpcDefinition } from "../../NpcDefinition";
import { NpcSpawnDefinition } from "../../NpcSpawnDefinition";
import { NPC } from "../../../entity/impl/npc/NPC";
import { Direction } from "../../../model/Direction";
import { Location } from "../../../model/Location";
import { DefinitionLoader } from "../DefinitionLoader";
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { PluginManager } from "../../../../plugins/PluginManager";

interface RawNpcSpawnDefinition {
    id: number;
    name?: string;
    x: number;
    y: number;
    level: number;
    wanderRadius?: number;
    direction?: number;
}

export class NpcSpawnDefinitionLoader extends DefinitionLoader {
    public static readonly DEFINITION_TYPE = "npc_spawns";
    private static readonly DEFAULT_WANDER_RADIUS = 5;
    private static readonly DEFAULT_CLIENT_DIRECTION = 6;
    private static readonly CLIENT_TO_SERVER_DIRECTION = [5, 6, 7, 3, 4, 0, 1, 2];
    private static readonly spawnedNpcs = new Set<NPC>();

    public load(): boolean {
        const loaded = this.loadSources<RawNpcSpawnDefinition>(
            NpcSpawnDefinitionLoader.DEFINITION_TYPE
        );
        const definitions: NpcSpawnDefinition[] = [];
        let totalCandidates = 0;
        let invalid = 0;
        let unsupported = 0;
        let vetoed = 0;

        for (const source of loaded.sources) {
            totalCandidates += source.definitions.length;
            for (const raw of source.definitions) {
                const definition = this.toDefinition(raw, source.name);
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
        }

        NpcSpawnDefinition.replace(definitions);
        const applied = this.applyToWorld(definitions);
        (invalid > 0 || unsupported > 0 || applied < definitions.length ? console.warn : console.debug)(
            `[npc-spawns] Loaded ${definitions.length} definitions from ` +
            `${loaded.sources.map((source) => source.name).join("+") || "none"} ` +
            `(candidates=${totalCandidates}, invalid=${invalid}, unsupported=${unsupported}, vetoed=${vetoed}, ` +
            `applied=${applied})`
        );
        return loaded.failures === 0;
    }

    public file(): string {
        return NpcSpawnDefinitionLoader.DEFINITION_TYPE;
    }

    private toDefinition(
        raw: RawNpcSpawnDefinition,
        source: string
    ): NpcSpawnDefinition | null {
        const id = Math.trunc(Number(raw?.id));
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
              ? CacheDefinitions.getNpc(id).spawnDirection & 7
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
        this.removePreviouslyAppliedNpcs();
        const availableCapacity = Math.max(
            0,
            World.getNpcs().capacityReturn() - World.getNpcs().sizeReturn() - 1
        );
        let applied = 0;
        for (const definition of definitions.slice(0, availableCapacity)) {
            const npc = NPC.create(definition.getId(), definition.getPosition());
            npc.getMovementCoordinator().setRadius(
                definition.getRadius() ?? NpcSpawnDefinitionLoader.DEFAULT_WANDER_RADIUS
            );
            npc.setFace(definition.getFacing());

            const describedNpc = npc as NPC & {
                setDescription?(description: string): void;
            };
            if (definition.getDescription() && describedNpc.setDescription) {
                describedNpc.setDescription(definition.getDescription());
            }
            if (World.getNpcs().add(npc)) {
                NpcSpawnDefinitionLoader.spawnedNpcs.add(npc);
                applied++;
            }
        }

        for (const player of World.getPlayers()) {
            const localNpcs = player.getLocalNpcs();
            if (Array.isArray(localNpcs)) {
                localNpcs.length = 0;
            }
        }
        return applied;
    }

    private removePreviouslyAppliedNpcs(): void {
        const addQueue = World.getAddNPCQueue();
        const removeQueue = World.getRemoveNPCQueue();
        for (const npc of NpcSpawnDefinitionLoader.spawnedNpcs) {
            for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) {
                addQueue.splice(index, 1);
            }
            for (
                let index = removeQueue.indexOf(npc);
                index !== -1;
                index = removeQueue.indexOf(npc)
            ) {
                removeQueue.splice(index, 1);
            }
            if (npc.isRegistered()) {
                World.getNpcs().remove(npc);
            }
        }
        NpcSpawnDefinitionLoader.spawnedNpcs.clear();
    }
}
