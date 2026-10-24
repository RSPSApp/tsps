import { CustomObjTypeLoader } from "../../../custom/items/CustomObjTypeLoader";
import { CustomNpcTypeLoader } from "../../../custom/npcs/CustomNpcTypeLoader";
import {
    ArchiveBasTypeLoader,
    BasTypeLoader,
    DummyBasTypeLoader,
} from "../../config/bastype/BasTypeLoader";
import { GraphicsDefaults } from "../../config/defaults/GraphicsDefaults";
import {
    DeferredArchiveEnumTypeLoader,
    EnumTypeLoader,
} from "../../config/enumtype/EnumTypeLoader";
import {
    ArchiveOverlayFloorTypeLoader,
    ArchiveUnderlayFloorTypeLoader,
    FloorTypeLoader,
    OverlayFloorTypeLoader,
} from "../../config/floortype/FloorTypeLoader";
import { ArchiveIdkTypeLoader, IdkTypeLoader } from "../../config/idktype/IdkTypeLoader";
import {
    ArchiveLocTypeLoader,
    IndexLocTypeLoader,
    LocTypeLoader,
} from "../../config/loctype/LocTypeLoader";
import { MapSceneTypeLoader } from "../../config/mapscenetype/MapSceneTypeLoader";
import {
    ArchiveMapElementTypeLoader,
    MapElementTypeLoader,
} from "../../config/meltype/MapElementTypeLoader";
import {
    ArchiveNpcTypeLoader,
    IndexNpcTypeLoader,
    NpcTypeLoader,
} from "../../config/npctype/NpcTypeLoader";
import {
    ArchiveObjTypeLoader,
    IndexObjTypeLoader,
    ObjTypeLoader,
    PostProcessedObjTypeLoader,
} from "../../config/objtype/ObjTypeLoader";
import { ArchiveParamTypeLoader, ParamTypeLoader } from "../../config/paramtype/ParamTypeLoader";
import {
    ArchiveSeqTypeLoader,
    IndexSeqTypeLoader,
    SeqTypeLoader,
} from "../../config/seqtype/SeqTypeLoader";
import {
    ArchiveSpotAnimTypeLoader,
    IndexSpotAnimTypeLoader,
    SpotAnimTypeLoader,
} from "../../config/spotanimtype/SpotAnimTypeLoader";
import {
    ArchiveStructTypeLoader,
    IndexStructTypeLoader,
    StructTypeLoader,
} from "../../config/structtype/StructTypeLoader";
import {
    ArchiveVarcIntTypeLoader,
    VarcIntTypeLoader,
} from "../../config/vartype/VarcIntTypeLoader";
import {
    ArchiveVarBitTypeLoader,
    IndexVarBitTypeLoader,
    VarBitTypeLoader,
} from "../../config/vartype/bit/VarBitTypeLoader";
import {
    ArchiveWorldEntityTypeLoader,
    WorldEntityTypeLoader,
} from "../../config/worldentitytype/WorldEntityTypeLoader";
import { Dat2MapIndex, MapFileIndex } from "../../map/MapFileIndex";
import { MapFileLoader } from "../../map/MapFileLoader";
import { IndexModelLoader, ModelLoader } from "../../model/ModelLoader";
import { IndexSeqBaseLoader, SeqBaseLoader } from "../../model/seq/SeqBaseLoader";
import { Dat2SeqFrameLoader, SeqFrameLoader } from "../../model/seq/SeqFrameLoader";
import { IndexSkeletalSeqLoader, SkeletalSeqLoader } from "../../model/skeletal/SkeletalSeqLoader";
import { IndexedSprite } from "../../sprite/IndexedSprite";
import { SpriteLoader } from "../../sprite/SpriteLoader";
import { OldProceduralTextureLoader } from "../../texture/OldProceduralTextureLoader";
import { ProceduralTextureLoader } from "../../texture/ProceduralTextureLoader";
import { SpriteTextureLoader } from "../../texture/SpriteTextureLoader";
import { TextureLoader } from "../../texture/TextureLoader";
import { ApiType } from "../ApiType";
import { CacheIndex } from "../CacheIndex";
import { CacheInfo } from "../CacheInfo";
import { CacheSystem } from "../CacheSystem";
import { CacheType } from "../CacheType";
import { ConfigType } from "../ConfigType";
import { IndexType } from "../IndexType";
import { CacheLoaderFactory } from "./CacheLoaderFactory";

export class Dat2CacheLoaderFactory implements CacheLoaderFactory {
    private enumTypeLoader?: EnumTypeLoader;
    private underlayTypeLoader?: FloorTypeLoader;
    private overlayTypeLoader?: OverlayFloorTypeLoader;
    private varBitTypeLoader?: VarBitTypeLoader;
    private varcIntTypeLoader?: VarcIntTypeLoader;
    private locTypeLoader?: LocTypeLoader;
    private npcTypeLoader?: NpcTypeLoader;
    private objTypeLoader?: ObjTypeLoader;
    private seqTypeLoader?: SeqTypeLoader;
    private spotAnimTypeLoader?: SpotAnimTypeLoader;
    private basTypeLoader?: BasTypeLoader;
    private paramTypeLoader?: ParamTypeLoader;
    private idkTypeLoader?: IdkTypeLoader;
    private structTypeLoader?: StructTypeLoader;
    private textureLoader?: TextureLoader;
    private modelLoader?: ModelLoader;
    private seqBaseLoader?: SeqBaseLoader;
    private seqFrameLoader?: SeqFrameLoader;
    private skeletalSeqLoader?: SkeletalSeqLoader;
    private worldEntityTypeLoader?: WorldEntityTypeLoader;
    private mapFileLoader?: MapFileLoader;
    private mapScenes?: IndexedSprite[];

    constructor(
        readonly cacheInfo: CacheInfo,
        readonly cacheType: CacheType,
        readonly cacheSystem: CacheSystem,
    ) {}

    isIndexConfigs(): boolean {
        return this.cacheInfo.game === "runescape" && this.cacheInfo.revision >= 488;
    }

    getUnderlayTypeLoader(): FloorTypeLoader {
        if (this.underlayTypeLoader) return this.underlayTypeLoader;
        const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
        const underlaysArchive = configIndex.getArchive(ConfigType.DAT2.underlays);
        return (this.underlayTypeLoader = new ArchiveUnderlayFloorTypeLoader(
            this.cacheInfo,
            underlaysArchive,
        ));
    }

    getOverlayTypeLoader(): OverlayFloorTypeLoader {
        if (this.overlayTypeLoader) return this.overlayTypeLoader;
        const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
        const overlaysArchive = configIndex.getArchive(ConfigType.DAT2.overlays);
        return (this.overlayTypeLoader = new ArchiveOverlayFloorTypeLoader(
            this.cacheInfo,
            overlaysArchive,
        ));
    }

    getVarBitTypeLoader(): VarBitTypeLoader {
        if (this.varBitTypeLoader) return this.varBitTypeLoader;
        if (this.isIndexConfigs()) {
            const varbitsIndex = this.cacheSystem.getIndex(IndexType.RS2.varbits);
            return (this.varBitTypeLoader = new IndexVarBitTypeLoader(
                this.cacheInfo,
                varbitsIndex,
            ));
        } else {
            const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
            const varbitsArchive = configIndex.getArchive(ConfigType.DAT2.varbits);
            return (this.varBitTypeLoader = new ArchiveVarBitTypeLoader(
                this.cacheInfo,
                varbitsArchive,
            ));
        }
    }

    getVarcIntTypeLoader(): VarcIntTypeLoader {
        if (this.varcIntTypeLoader) return this.varcIntTypeLoader;
        const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
        const varcArchive = configIndex.getArchive(ConfigType.DAT2.varClient);
        return (this.varcIntTypeLoader = new ArchiveVarcIntTypeLoader(
            this.cacheInfo,
            varcArchive,
        ));
    }

    getLocTypeLoader(): LocTypeLoader {
        if (this.locTypeLoader) return this.locTypeLoader;
        if (this.isIndexConfigs()) {
            const locsIndex = this.cacheSystem.getIndex(IndexType.RS2.locs);
            return (this.locTypeLoader = new IndexLocTypeLoader(this.cacheInfo, locsIndex));
        } else {
            const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
            const locsArchive = configIndex.getArchive(ConfigType.DAT2.locs);
            return (this.locTypeLoader = new ArchiveLocTypeLoader(this.cacheInfo, locsArchive));
        }
    }

    getNpcTypeLoader(): NpcTypeLoader {
        if (this.npcTypeLoader) return this.npcTypeLoader;
        let baseLoader: NpcTypeLoader;
        if (this.isIndexConfigs()) {
            const npcIndex = this.cacheSystem.getIndex(IndexType.RS2.npcs);
            baseLoader = new IndexNpcTypeLoader(this.cacheInfo, npcIndex);
        } else {
            const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
            const npcsArchive = configIndex.getArchive(ConfigType.DAT2.npcs);
            baseLoader = new ArchiveNpcTypeLoader(this.cacheInfo, npcsArchive);
        }
        // Wrap to resolve the server's npc model customisations (synthetic type ids).
        return (this.npcTypeLoader = new CustomNpcTypeLoader(baseLoader));
    }

    getObjTypeLoader(): ObjTypeLoader {
        if (this.objTypeLoader) return this.objTypeLoader;
        let baseLoader: ObjTypeLoader;
        if (this.isIndexConfigs()) {
            const objIndex = this.cacheSystem.getIndex(IndexType.RS2.objs);
            baseLoader = new PostProcessedObjTypeLoader(
                new IndexObjTypeLoader(this.cacheInfo, objIndex),
            );
        } else {
            const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
            const objsArchive = configIndex.getArchive(ConfigType.DAT2.objs);
            baseLoader = new PostProcessedObjTypeLoader(
                new ArchiveObjTypeLoader(this.cacheInfo, objsArchive),
            );
        }
        // Wrap with custom item loader to support custom items
        return (this.objTypeLoader = new CustomObjTypeLoader(baseLoader, this.cacheInfo));
    }

    getSeqTypeLoader(): SeqTypeLoader {
        if (this.seqTypeLoader) return this.seqTypeLoader;
        if (this.isIndexConfigs()) {
            const seqIndex = this.cacheSystem.getIndex(IndexType.RS2.seqs);
            return (this.seqTypeLoader = new IndexSeqTypeLoader(this.cacheInfo, seqIndex));
        } else {
            const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
            const seqsArchive = configIndex.getArchive(ConfigType.DAT2.seqs);
            return (this.seqTypeLoader = new ArchiveSeqTypeLoader(this.cacheInfo, seqsArchive));
        }
    }

    getSpotAnimTypeLoader(): SpotAnimTypeLoader {
        if (this.spotAnimTypeLoader) return this.spotAnimTypeLoader;
        if (this.isIndexConfigs()) {
            const spotIndex = this.cacheSystem.getIndex(IndexType.RS2.spotAnims);
            return (this.spotAnimTypeLoader = new IndexSpotAnimTypeLoader(
                this.cacheInfo,
                spotIndex,
            ));
        } else {
            const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
            const spotArchive = configIndex.getArchive(ConfigType.DAT2.spotAnims);
            return (this.spotAnimTypeLoader = new ArchiveSpotAnimTypeLoader(
                this.cacheInfo,
                spotArchive,
            ));
        }
    }

    getBasTypeLoader(): BasTypeLoader {
        if (this.basTypeLoader) return this.basTypeLoader;
        if (this.cacheInfo.game === "runescape" && this.cacheInfo.revision >= 530) {
            const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
            try {
                const basArchive = configIndex.getArchive(ConfigType.RS2.bas);
                return (this.basTypeLoader = new ArchiveBasTypeLoader(
                    this.cacheInfo,
                    basArchive,
                ));
            } catch (e) {
                console.error("Failed to load bastype archive", e);
            }
        }
        return new DummyBasTypeLoader(this.cacheInfo);
    }

    getParamTypeLoader(): ParamTypeLoader {
        if (this.paramTypeLoader) return this.paramTypeLoader;
        const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
        const paramsArchive = configIndex.getArchive(ConfigType.DAT2.params);
        return (this.paramTypeLoader = new ArchiveParamTypeLoader(
            this.cacheInfo,
            paramsArchive,
        ));
    }

    getIdkTypeLoader(): IdkTypeLoader {
        if (this.idkTypeLoader) return this.idkTypeLoader;
        const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
        const idkArchive = configIndex.getArchive(ConfigType.DAT2.identkits);
        return (this.idkTypeLoader = new ArchiveIdkTypeLoader(this.cacheInfo, idkArchive));
    }

    getEnumTypeLoader(): EnumTypeLoader | undefined {
        if (this.enumTypeLoader) return this.enumTypeLoader;
        const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
        if (!configIndex.archiveExists(ConfigType.DAT2.enums)) return undefined;

        // The browser streams config archives on demand. Reading it here can race
        // startup and permanently leave the CS2 VM without enum definitions.
        return this.enumTypeLoader = new DeferredArchiveEnumTypeLoader(this.cacheInfo, () =>
            configIndex.getArchive(ConfigType.DAT2.enums),
        );
    }

    getStructTypeLoader(): StructTypeLoader | undefined {
        if (this.structTypeLoader) return this.structTypeLoader;
        try {
            const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
            // Structs are at archive 34 for OSRS caches
            if (
                this.cacheInfo.game === "oldschool" &&
                configIndex.archiveExists(ConfigType.OSRS.struct)
            ) {
                const structsArchive = configIndex.getArchive(ConfigType.OSRS.struct);
                return (this.structTypeLoader = new ArchiveStructTypeLoader(
                    this.cacheInfo,
                    structsArchive,
                ));
            }
        } catch (e) {
            console.error("Failed to load struct archive", e);
        }
        return undefined;
    }

    getTextureLoader(): TextureLoader {
        if (this.textureLoader) return this.textureLoader;
        const textureIndex = this.cacheSystem.getIndex(IndexType.DAT2.textures);
        const spriteIndex = this.cacheSystem.getIndex(IndexType.DAT2.sprites);
        if (
            this.cacheInfo.game === "oldschool" ||
            (this.cacheInfo.game === "runescape" && this.cacheInfo.revision < 474)
        ) {
            const isSimplified =
                this.cacheInfo.game === "oldschool" && this.cacheInfo.revision >= 233;
            return (this.textureLoader = SpriteTextureLoader.load(
                textureIndex,
                spriteIndex,
                isSimplified,
            ));
        } else if (this.cacheSystem.indexExists(IndexType.RS2.materials)) {
            // materials starting 499 or 500
            const materialIndex = this.cacheSystem.getIndex(IndexType.RS2.materials);

            return (this.textureLoader = ProceduralTextureLoader.load(
                this.cacheInfo.revision,
                materialIndex,
                textureIndex,
                spriteIndex,
            ));
        } else {
            return (this.textureLoader = OldProceduralTextureLoader.load(
                textureIndex,
                spriteIndex,
            ));
        }
    }

    getModelLoader(): ModelLoader {
        if (this.modelLoader) return this.modelLoader;
        const modelIndex = this.cacheSystem.getIndex(IndexType.DAT2.models);
        return (this.modelLoader = new IndexModelLoader(modelIndex));
    }

    getSeqBaseLoader(): SeqBaseLoader {
        if (this.seqBaseLoader) return this.seqBaseLoader;
        const index = this.cacheSystem.getIndex(IndexType.DAT2.skeletons);
        return (this.seqBaseLoader = new IndexSeqBaseLoader(this.cacheInfo, index));
    }

    getSeqFrameLoader(): SeqFrameLoader {
        if (this.seqFrameLoader) return this.seqFrameLoader;
        const index = this.cacheSystem.getIndex(IndexType.DAT2.animations);
        return (this.seqFrameLoader = new Dat2SeqFrameLoader(
            this.cacheInfo,
            index,
            this.getSeqBaseLoader(),
        ));
    }

    getSkeletalSeqLoader(): SkeletalSeqLoader | undefined {
        if (this.skeletalSeqLoader) return this.skeletalSeqLoader;
        if (this.cacheInfo.game === "oldschool" && this.cacheInfo.revision >= 229) {
            const index = this.cacheSystem.getIndex(IndexType.OSRS.animKeyFrames);
            return (this.skeletalSeqLoader = new IndexSkeletalSeqLoader(
                index,
                this.getSeqBaseLoader(),
            ));
        }
        const index = this.cacheSystem.getIndex(IndexType.DAT2.animations);
        return (this.skeletalSeqLoader = new IndexSkeletalSeqLoader(
            index,
            this.getSeqBaseLoader(),
        ));
    }

    getWorldEntityTypeLoader(): WorldEntityTypeLoader | undefined {
        if (this.worldEntityTypeLoader) return this.worldEntityTypeLoader;
        try {
            const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
            const archive = configIndex.getArchive(ConfigType.OSRS.worldEntity);
            return (this.worldEntityTypeLoader = new ArchiveWorldEntityTypeLoader(
                this.cacheInfo,
                archive,
            ));
        } catch {
            return undefined;
        }
    }

    getMapFileLoader(): MapFileLoader {
        if (this.mapFileLoader) return this.mapFileLoader;
        const mapIndex = this.cacheSystem.getIndex(IndexType.DAT2.maps);
        const mapFileIndex = new Dat2MapIndex(mapIndex);
        return (this.mapFileLoader = new MapFileLoader(mapIndex, mapFileIndex));
    }

    getMapScenes(): IndexedSprite[] {
        if (this.mapScenes) return this.mapScenes;
        const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
        const spriteIndex = this.cacheSystem.getIndex(IndexType.DAT2.sprites);

        if (
            this.cacheInfo.game === "runescape" &&
            configIndex.archiveExists(ConfigType.RS2.mapScenes)
        ) {
            const mapScenesArchive = configIndex.getArchive(ConfigType.RS2.mapScenes);
            const mapSceneTypeLoader = new MapSceneTypeLoader(this.cacheInfo, mapScenesArchive);

            const mapSceneSprites = new Array<IndexedSprite>(mapScenesArchive.lastFileId);
            for (const id of mapScenesArchive.fileIds) {
                const mapScene = mapSceneTypeLoader.load(id);
                if (mapScene.spriteId === -1) {
                    continue;
                }
                const sprite = SpriteLoader.loadIntoIndexedSprite(spriteIndex, mapScene.spriteId);
                if (sprite) {
                    mapSceneSprites[id] = sprite;
                }
            }

            return (this.mapScenes = mapSceneSprites);
        } else {
            const graphicDefaults = GraphicsDefaults.load(this.cacheInfo, this.cacheSystem);
            if (graphicDefaults.mapScenes === -1) {
                return (this.mapScenes = []);
            }
            const mapScenes = SpriteLoader.loadIntoIndexedSprites(
                spriteIndex,
                graphicDefaults.mapScenes,
            );
            if (!mapScenes) {
                throw new Error("Failed to load map scenes");
            }

            return (this.mapScenes = mapScenes);
        }
    }

    loadMapElementSprites(
        spriteIndex: CacheIndex,
        mapElementTypeLoader: MapElementTypeLoader,
    ): IndexedSprite[] {
        const mapElementSprites = new Array<IndexedSprite>(mapElementTypeLoader.getCount());
        for (let i = 0; i < mapElementSprites.length; i++) {
            const mapElement = mapElementTypeLoader.load(i);
            if (mapElement.spriteId === -1) {
                continue;
            }
            const sprite = SpriteLoader.loadIntoIndexedSprite(spriteIndex, mapElement.spriteId);
            if (sprite) {
                mapElementSprites[i] = sprite;
            }
        }
        return mapElementSprites;
    }

    getMapFunctions(): IndexedSprite[] {
        const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
        const spriteIndex = this.cacheSystem.getIndex(IndexType.DAT2.sprites);

        if (
            this.cacheInfo.game === "oldschool" &&
            configIndex.archiveExists(ConfigType.OSRS.mapFunctions)
        ) {
            const mapElementArchive = configIndex.getArchive(ConfigType.OSRS.mapFunctions);
            const mapElementTypeLoader = new ArchiveMapElementTypeLoader(
                this.cacheInfo,
                mapElementArchive,
            );

            return this.loadMapElementSprites(spriteIndex, mapElementTypeLoader);
        } else if (
            this.cacheInfo.game === "runescape" &&
            configIndex.archiveExists(ConfigType.RS2.mapFunctions)
        ) {
            const mapElementArchive = configIndex.getArchive(ConfigType.RS2.mapFunctions);
            const mapElementTypeLoader = new ArchiveMapElementTypeLoader(
                this.cacheInfo,
                mapElementArchive,
            );

            return this.loadMapElementSprites(spriteIndex, mapElementTypeLoader);
        } else {
            const graphicDefaults = GraphicsDefaults.load(this.cacheInfo, this.cacheSystem);
            if (graphicDefaults.mapFunctions === -1) {
                return [];
            }

            const mapFunctions = SpriteLoader.loadIntoIndexedSprites(
                spriteIndex,
                graphicDefaults.mapFunctions,
            );

            if (!mapFunctions) {
                throw new Error("Failed to load map functions");
            }

            return mapFunctions;
        }
    }
}
