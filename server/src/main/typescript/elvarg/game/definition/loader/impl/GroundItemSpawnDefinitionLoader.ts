import * as fs from "fs";
import { isMembersWorld } from "../../WorldDefinition";
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { ItemOnGround, State } from "../../../entity/impl/grounditem/ItemOnGround";
import { ItemOnGroundManager } from "../../../entity/impl/grounditem/ItemOnGroundManager";
import { GameConstants } from "../../../GameConstants";
import { Item } from "../../../model/Item";
import { Location } from "../../../model/Location";
import { DefinitionLoader, LoadedDefinitionSource } from "../DefinitionLoader";

interface RawGroundItemSpawn {
    id?: number;
    location?: { x?: number; y?: number; z?: number };
    amt?: number;
    respawn?: number;
    members?: boolean;
}

/**
 * Static world ground spawns (Cook's egg, clock tower cogs, quest items, ...).
 * Every entry becomes a global item seen by everyone with no owner, so
 * `respawn > 0` brings it back after a pickup while `respawn == 0` means a
 * permanent fixture that never respawns or despawns.
 */
export class GroundItemSpawnDefinitionLoader extends DefinitionLoader {
    public static readonly DEFINITION_TYPE = "ground_items";
    public static readonly CORE_SOURCE = "ground-items";

    public load(): boolean {
        const contributed = this.loadSources<RawGroundItemSpawn>(
            GroundItemSpawnDefinitionLoader.DEFINITION_TYPE
        );
        const sources: LoadedDefinitionSource<RawGroundItemSpawn>[] = [
            {
                name: GroundItemSpawnDefinitionLoader.CORE_SOURCE,
                owner: GroundItemSpawnDefinitionLoader.CORE_SOURCE,
                priority: 0,
                definitions: this.readCoreDefinitions(),
            },
            ...contributed.sources,
        ].sort((a, b) => {
            const priorityDifference = a.priority - b.priority;
            return priorityDifference !== 0
                ? priorityDifference
                : a.name.localeCompare(b.name);
        });

        let candidates = 0;
        let invalid = 0;
        let unsupported = 0;
        let applied = 0;
        let membersSkipped = 0;
        for (const source of sources) {
            candidates += source.definitions.length;
            for (const raw of source.definitions) {
                const item = this.toItemOnGround(raw);
                if (!item) {
                    invalid++;
                    continue;
                }
                if (raw.members === true && !isMembersWorld()) {
                    membersSkipped++;
                    continue;
                }
                if (!CacheDefinitions.hasItem(item.getItem().getId())) {
                    unsupported++;
                    continue;
                }
                ItemOnGroundManager.register(item);
                applied++;
            }
        }

        (invalid > 0 || unsupported > 0 ? console.warn : console.debug)(
            `[ground-items] Loaded ${applied} definitions from ` +
            `${sources.map((source) => source.name).join("+") || "none"} ` +
            `(candidates=${candidates}, invalid=${invalid}, unsupported=${unsupported}, membersSkipped=${membersSkipped})`
        );
        return contributed.failures === 0;
    }

    public file(): string {
        return GameConstants.DEFINITIONS_DIRECTORY + "ground-items.json";
    }

    private readCoreDefinitions(): RawGroundItemSpawn[] {
        const file = this.file();
        const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!Array.isArray(parsed)) {
            throw new Error(`${file} must contain an array`);
        }
        return parsed as RawGroundItemSpawn[];
    }

    private toItemOnGround(raw: RawGroundItemSpawn): ItemOnGround | null {
        const id = Number(raw?.id);
        const x = Number(raw?.location?.x);
        const y = Number(raw?.location?.y);
        const z = Number(raw?.location?.z);
        const amount = raw?.amt === undefined ? 1 : Number(raw.amt);
        const respawn = raw?.respawn === undefined ? 0 : Number(raw.respawn);
        if (
            !Number.isInteger(id) || id < 0 ||
            !Number.isInteger(x) ||
            !Number.isInteger(y) ||
            !Number.isInteger(z) || z < 0 || z > 3 ||
            !Number.isInteger(amount) || amount <= 0 ||
            !Number.isInteger(respawn) || respawn < 0 ||
            (raw.members !== undefined && typeof raw.members !== "boolean")
        ) {
            return null;
        }
        return new ItemOnGround(
            State.SEEN_BY_EVERYONE,
            undefined,
            new Location(x, y, z),
            new Item(id, amount),
            false,
            respawn > 0 ? respawn : -1,
            null,
            true
        );
    }
}
