import { mapEditFiles } from "../../../../util/MapEditFiles";
import { DefinitionLoader } from '../DefinitionLoader';
import { GameConstants } from '../../../GameConstants';
import { ObjectSpawnDefinition } from '../../ObjectSpawnDefinition';
import { GameObject } from '../../../entity/impl/object/GameObject';
import { ObjectManager } from '../../../entity/impl/object/ObjectManager';
import * as fs from "fs";
import { RegionManager } from "../../../collision/RegionManager";
import { Location } from '../../../model/Location';

interface RawObjectSpawn {
    id: number;
    position: { x: number; y: number; z: number };
    type?: number;
    face?: number;
    remove?: boolean;
}

export class ObjectSpawnDefinitionLoader extends DefinitionLoader {
    public static readonly DEFINITION_TYPE = "object_spawns";
    load() {
        const filePath = mapEditFiles.effectiveFile(this.file());
        const content = filePath ? fs.readFileSync(filePath, "utf8") : "[]";
        const core = JSON.parse(content);
        if (!Array.isArray(core)) throw new Error(`${filePath}: expected object spawn array`);
        const loaded = this.loadSources<RawObjectSpawn>(ObjectSpawnDefinitionLoader.DEFINITION_TYPE);
        const defs: RawObjectSpawn[] = [core, ...loaded.sources.map((source) => source.definitions)].flat();
        for (const def of defs) {
            if (!Number.isInteger(def?.id) || def.id < 0
                || !Number.isInteger(def.position?.x) || !Number.isInteger(def.position?.y)
                || !Number.isInteger(def.position?.z) || def.position.z < 0 || def.position.z > 3
                || (def.type !== undefined && (!Number.isInteger(def.type) || def.type < 0 || def.type > 22))
                || (def.remove !== undefined && typeof def.remove !== "boolean")
                || (def.face !== undefined && (!Number.isInteger(def.face) || def.face < 0 || def.face > 3))) {
                throw new Error(`Invalid object spawn: ${JSON.stringify(def)}`);
            }
            const spawn = new ObjectSpawnDefinition(def.id, new Location(def.position.x, def.position.y, def.position.z));
            const type = def.type ?? spawn.getType();
            const face = def.face ?? spawn.getFace();
            const object = new GameObject(def.id, spawn.getPosition(), type, face, null);
            if (def.remove === true) {
                // Decode the base objects and collision before applying a saved removal.
                RegionManager.loadMapFiles(def.position.x, def.position.y);
                ObjectManager.deregister(object, true);
            } else {
                ObjectManager.register(object, true);
            }
        }
    }

    file(): string {
        return GameConstants.DEFINITIONS_DIRECTORY + "object-spawns.json";
    }
}
