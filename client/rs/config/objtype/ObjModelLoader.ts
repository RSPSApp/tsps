import { DEBUG_MODEL_ID, dumpModelColors } from "../../../custom/items/ColorDebugUtil";
import { CustomItemRegistry } from "../../../custom/items/CustomItemRegistry";
import { CustomModelRegistry } from "../../../custom/items/CustomModelRegistry";
import { GearVisualRegistry } from "../../../custom/items/GearVisualRegistry";
import { Model } from "../../model/Model";
import { ModelLoader } from "../../model/ModelLoader";
import { TextureLoader } from "../../texture/TextureLoader";
import { ObjTypeLoader } from "./ObjTypeLoader";

export class ObjModelLoader {
    modelCache: Map<number|string, Model>;
    private customRevision = -1;

    constructor(
        readonly objTypeLoader: ObjTypeLoader,
        readonly modelLoader: ModelLoader,
        readonly textureLoader: TextureLoader,
    ) {
        this.objTypeLoader = objTypeLoader;
        this.modelLoader = modelLoader;
        this.textureLoader = textureLoader;
        this.modelCache = new Map();
    }

    getModel(id: number, count: number): Model | undefined {
        const revision = CustomItemRegistry.revision + CustomModelRegistry.revision;
        if (this.customRevision !== revision) {
            this.clearCache();
            this.customRevision = revision;
        }
        if (id === -1) {
            return undefined;
        }

        const objType = this.objTypeLoader.load(id);
        if (objType.model === undefined) {
            return undefined;
        }
        if (objType.countObj && count > 1) {
            let countId = -1;
            for (let i = 0; i < 10; i++) {
                if (count >= objType.countCo[i] && objType.countCo[i] !== 0) {
                    countId = objType.countObj[i];
                }
            }

            if (countId !== -1) {
                return this.getModel(countId, 1);
            }
        }

        const key=GearVisualRegistry.dynamic(id)?`${id}~${GearVisualRegistry.frame}`:id;
        let model = this.modelCache.get(key);
        if (model) {
            return model;
        }

        const modelData = this.modelLoader.getModel(objType.model);
        if (!modelData) {
            return undefined;
        }

        // Debug: dump model colors if debugging is enabled for this model
        if (DEBUG_MODEL_ID !== null && objType.model === DEBUG_MODEL_ID) {
            dumpModelColors(objType.model, modelData.faceColors);
        }

        if (objType.resizeX !== 128 || objType.resizeY !== 128 || objType.resizeZ !== 128) {
            modelData.resize(objType.resizeX, objType.resizeY, objType.resizeZ);
        }

        if (objType.recolorFrom) {
            const retexture =
                objType.cacheInfo.game === "runescape" && objType.cacheInfo.revision <= 464;
            for (let i = 0; i < objType.recolorFrom.length; i++) {
                modelData.recolor(objType.recolorFrom[i], objType.recolorTo[i]);
                if (retexture) {
                    modelData.retexture(objType.recolorFrom[i], objType.recolorTo[i]);
                }
            }
        }

        if (objType.retextureFrom) {
            for (let i = 0; i < objType.retextureFrom.length; i++) {
                modelData.retexture(objType.retextureFrom[i], objType.retextureTo[i]);
            }
        }

        model = modelData.light(
            this.textureLoader,
            objType.ambient + 64,
            objType.contrast + 768,
            -50,
            -10,
            -50,
        );
        this.modelCache.set(key, model);
        while(this.modelCache.size>256)this.modelCache.delete(this.modelCache.keys().next().value!);
        return model;
    }

    clearCache() {
        this.modelCache.clear();
    }
}
