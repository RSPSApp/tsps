// Ported to TypeScript from ScreteMonge/3D-Weather (BSD-2-Clause); the model
// transforms below mirror its ModelHandler.java 1:1.
import type { Model } from "../../../rs/model/Model";
import { Model as ModelClass } from "../../../rs/model/Model";
import { ModelData } from "../../../rs/model/ModelData";
import type { ModelLoader } from "../../../rs/model/ModelLoader";
import type { SeqFrameLoader } from "../../../rs/model/seq/SeqFrameLoader";
import type { SeqType } from "../../../rs/config/seqtype/SeqType";
import type { SeqTypeLoader } from "../../../rs/config/seqtype/SeqTypeLoader";
import type { TextureLoader } from "../../../rs/texture/TextureLoader";
import { hslToRgb, packHsl } from "../../../rs/util/ColorUtil";
import { getModelFaces } from "../../../render/buffer/SceneBuffer";
import { Weather } from "./WeatherConditions";

/** RuneLite ModelData defaults, used by `light()` with no explicit arguments. */
const DEFAULT_AMBIENT = 64;
const DEFAULT_CONTRAST = 768;
const DEFAULT_LIGHT_X = -50;
const DEFAULT_LIGHT_Y = -10;
const DEFAULT_LIGHT_Z = -50;

export interface WeatherGeometry {
    positions: Float32Array;
    colors: Uint8Array;
    indices: Uint32Array;
}

interface VariantSpec {
    scale: [number, number, number];
    translate: [number, number, number];
    rotation: 0 | 90 | 180 | 270;
    /** [face colour index in the source model, packed HSL] */
    recolors: Array<[number, number]>;
    light?: { ambient: number; contrast: number };
    /** RuneLite fills the model's face transparencies after lighting. */
    alphaFill?: number;
}

interface WeatherModelSpec {
    modelId: number;
    animationId: number;
    variants: VariantSpec[];
    transparentVariants?: VariantSpec[];
}

function variant(
    scale: [number, number, number],
    translate: [number, number, number] = [0, 0, 0],
    rotation: 0 | 90 | 180 | 270 = 0,
    recolors: Array<[number, number]> = [],
    options: Pick<VariantSpec, "light" | "alphaFill"> = {},
): VariantSpec {
    return { scale, translate, rotation, recolors, ...options };
}

const CLOUD_SCALE_1: [number, number, number] = [650, 325, 650];
const CLOUD_SCALE_2: [number, number, number] = [1000, 500, 1000];
const CLOUD_SCALE_3: [number, number, number] = [800, 400, 800];

const CLOUD_TO_TP: VariantSpec["alphaFill"] = -23;
const STAR_TO_TP: VariantSpec["alphaFill"] = -80;

/** Model ids/animation ids are the ones the upstream plugin hard-codes. */
const SPECS: Record<Weather, WeatherModelSpec> = {
    [Weather.ASHFALL]: {
        modelId: 27835,
        animationId: 7000,
        variants: [
            variant([128, 192, 128], [0, 180, 0], 0, [[0, packHsl(39, 1, 40)], [2, packHsl(39, 1, 40)]]),
            variant([128, 192, 128], [0, 180, 0], 90, [[0, packHsl(39, 1, 40)], [2, packHsl(39, 1, 40)]]),
            variant([128, 192, 128], [0, 180, 0], 270, [[0, packHsl(39, 1, 40)], [2, packHsl(39, 1, 40)]]),
        ],
    },
    [Weather.CLOUDY]: {
        modelId: 4086,
        animationId: 6470,
        variants: [
            variant(CLOUD_SCALE_1, [0, -1000, 0], 0, [[0, packHsl(54, 0, 110)]]),
            variant(CLOUD_SCALE_2, [0, -1400, 0], 90, [[0, packHsl(54, 0, 110)]]),
            variant(CLOUD_SCALE_3, [0, -1200, 0], 180, [[0, packHsl(54, 0, 110)]]),
        ],
        transparentVariants: [
            variant(CLOUD_SCALE_1, [0, -1000, 0], 0, [[0, packHsl(54, 0, 110)]], { alphaFill: CLOUD_TO_TP }),
            variant(CLOUD_SCALE_2, [0, -1400, 0], 90, [[0, packHsl(54, 0, 110)]], { alphaFill: CLOUD_TO_TP }),
            variant(CLOUD_SCALE_3, [0, -1200, 0], 180, [[0, packHsl(54, 0, 110)]], { alphaFill: CLOUD_TO_TP }),
        ],
    },
    [Weather.PARTLY_CLOUDY]: {
        modelId: 4086,
        animationId: 6470,
        variants: [
            variant(CLOUD_SCALE_1, [0, -1000, 0], 0, [[0, packHsl(54, 0, 110)]]),
            variant(CLOUD_SCALE_2, [0, -1400, 0], 90, [[0, packHsl(54, 0, 110)]]),
            variant(CLOUD_SCALE_3, [0, -1200, 0], 180, [[0, packHsl(54, 0, 110)]]),
        ],
        transparentVariants: [
            variant(CLOUD_SCALE_1, [0, -1000, 0], 0, [[0, packHsl(54, 0, 110)]], { alphaFill: CLOUD_TO_TP }),
            variant(CLOUD_SCALE_2, [0, -1400, 0], 90, [[0, packHsl(54, 0, 110)]], { alphaFill: CLOUD_TO_TP }),
            variant(CLOUD_SCALE_3, [0, -1200, 0], 180, [[0, packHsl(54, 0, 110)]], { alphaFill: CLOUD_TO_TP }),
        ],
    },
    [Weather.FOGGY]: {
        modelId: 29290,
        // Upstream maps FOGGY to the cloud animation (fogAnimation = loadAnimation(CLOUD_ANIMATION)).
        animationId: 6470,
        variants: [
            variant([190, 110, 190], [0, -70, 0], 0, [[0, packHsl(54, 0, 77)]], {
                light: { ambient: 200, contrast: DEFAULT_CONTRAST },
                alphaFill: -15,
            }),
        ],
    },
    [Weather.RAINY]: {
        modelId: 15524,
        animationId: 7001,
        variants: [
            variant([100, 256, 100], [0, 0, 0], 0, [[0, packHsl(32, 1, 127)], [23, packHsl(32, 1, 120)]]),
            variant([90, 256, 90], [0, 0, 0], 90, [[0, packHsl(32, 1, 127)], [23, packHsl(32, 1, 120)]]),
            variant([110, 256, 110], [0, 0, 0], 270, [[0, packHsl(32, 1, 127)], [23, packHsl(32, 1, 120)]]),
        ],
    },
    [Weather.SNOWY]: {
        modelId: 27835,
        animationId: 7000,
        variants: [
            variant([128, 192, 128], [0, 190, 0]),
            variant([128, 192, 128], [0, 190, 0], 90),
            variant([128, 192, 128], [0, 190, 0], 270),
        ],
    },
    [Weather.STARRY]: {
        modelId: 16374,
        animationId: 7971,
        variants: [
            variant([80, 80, 80], [0, -1400, 0], 0, [[0, packHsl(10, 4, 60)], [45, packHsl(10, 6, 80)]], {
                light: { ambient: DEFAULT_AMBIENT, contrast: 1400 },
            }),
            variant([65, 65, 65], [0, -1500, 0], 0, [[0, packHsl(10, 4, 60)], [45, packHsl(10, 6, 80)]], {
                light: { ambient: DEFAULT_AMBIENT, contrast: 1400 },
            }),
            variant([95, 95, 95], [0, -1300, 0], 0, [[0, packHsl(10, 4, 60)], [45, packHsl(10, 6, 80)]], {
                light: { ambient: DEFAULT_AMBIENT, contrast: 1400 },
            }),
        ],
        transparentVariants: [
            variant([80, 80, 80], [0, -1400, 0], 0, [[0, packHsl(10, 4, 60)], [45, packHsl(10, 6, 80)]], {
                light: { ambient: DEFAULT_AMBIENT, contrast: 1400 },
                alphaFill: STAR_TO_TP,
            }),
            variant([65, 65, 65], [0, -1500, 0], 0, [[0, packHsl(10, 4, 60)], [45, packHsl(10, 6, 80)]], {
                light: { ambient: DEFAULT_AMBIENT, contrast: 1400 },
                alphaFill: STAR_TO_TP,
            }),
            variant([95, 95, 95], [0, -1300, 0], 0, [[0, packHsl(10, 4, 60)], [45, packHsl(10, 6, 80)]], {
                light: { ambient: DEFAULT_AMBIENT, contrast: 1400 },
                alphaFill: STAR_TO_TP,
            }),
        ],
    },
    [Weather.STORMY]: {
        modelId: 15524,
        animationId: 7001,
        variants: [
            variant([110, 410, 110], [0, 0, 0], 0, [[0, packHsl(38, 1, 110)], [23, packHsl(38, 2, 105)]]),
            // Upstream rotates both the second and third storm variants 90 degrees.
            variant([100, 410, 100], [0, 0, 0], 90, [[0, packHsl(38, 1, 110)], [23, packHsl(38, 2, 105)]]),
            variant([120, 410, 120], [0, 0, 0], 90, [[0, packHsl(38, 1, 110)], [23, packHsl(38, 2, 105)]]),
        ],
    },
    // No precipitation; nothing is ever built for these.
    [Weather.COVERED]: { modelId: -1, animationId: -1, variants: [] },
    [Weather.SUNNY]: { modelId: -1, animationId: -1, variants: [] },
};

export function weatherHasModel(weather: Weather): boolean {
    return SPECS[weather].modelId >= 0;
}

export function weatherAnimationId(weather: Weather): number {
    return SPECS[weather].animationId;
}

/**
 * Builds the upstream plugin's weather models out of the cache and cuts them
 * into GPU-ready geometry, one frame at a time.
 */
export class WeatherModelBuilder {
    private readonly modelDataCache = new Map<number, ModelData>();
    private readonly sequenceCache = new Map<number, SeqType>();
    private readonly frameOffsetCache = new Map<Weather, number[] | undefined>();
    private readonly geometryCache = new Map<string, WeatherGeometry>();

    constructor(
        private readonly modelLoader: ModelLoader,
        private readonly seqTypeLoader: SeqTypeLoader,
        private readonly seqFrameLoader: SeqFrameLoader,
        private readonly textureLoader: TextureLoader,
    ) {}

    getSequence(weather: Weather): SeqType | undefined {
        const id = SPECS[weather].animationId;
        if (id < 0) return undefined;
        let seq = this.sequenceCache.get(id);
        if (!seq) {
            try {
                seq = this.seqTypeLoader.load(id);
            } catch {
                return undefined;
            }
            if (!seq) return undefined;
            this.sequenceCache.set(id, seq);
        }
        return seq;
    }

    getFrameCount(weather: Weather): number {
        const seq = this.getSequence(weather);
        return Math.max(1, seq?.frameIds?.length ?? 1);
    }

    private getFrameOffsets(weather: Weather): number[] | undefined {
        if (this.frameOffsetCache.has(weather)) return this.frameOffsetCache.get(weather);
        const seq = this.getSequence(weather);
        let offsets: number[] | undefined;
        if (seq?.frameIds && seq.frameIds.length > 0 && !seq.isSkeletalSeq?.()) {
            offsets = new Array<number>(seq.frameIds.length);
            let acc = 0;
            for (let i = 0; i < seq.frameIds.length; i++) {
                acc += Math.max(1, seq.getFrameLength(this.seqFrameLoader, i));
                offsets[i] = acc;
            }
        }
        this.frameOffsetCache.set(weather, offsets);
        return offsets;
    }

    /** Animation frame index for an instance `ageMs` old, as the client cycles it. */
    frameIndexAt(weather: Weather, ageMs: number): number {
        const offsets = this.getFrameOffsets(weather);
        if (!offsets || offsets.length === 0) return 0;
        const total = offsets[offsets.length - 1];
        if (!(total > 0)) return 0;
        const t = ((Math.max(0, Math.floor(ageMs / 20)) % total) + total) % total;
        let low = 0;
        let high = offsets.length - 1;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (t < offsets[mid]) high = mid;
            else low = mid + 1;
        }
        return low;
    }

    /** One game animation loop in milliseconds, for per-object phase offsets. */
    animationDurationMs(weather: Weather): number {
        const offsets = this.getFrameOffsets(weather);
        return Math.max(20, (offsets?.[offsets.length - 1] ?? 1) * 20);
    }

    private getSourceModelData(modelId: number): ModelData | undefined {
        let data = this.modelDataCache.get(modelId);
        if (data) return data;
        const loaded = this.modelLoader.getModel(modelId);
        if (!loaded) return undefined;
        data = loaded;
        this.modelDataCache.set(modelId, data);
        return data;
    }

    /** The un-animated (base) model for a weather/variant, as ModelHandler builds it. */
    buildBase(weather: Weather, variantIndex: number, transparent: boolean): Model | undefined {
        const spec = SPECS[weather];
        if (spec.modelId < 0) return undefined;
        const source = this.getSourceModelData(spec.modelId);
        if (!source) return undefined;

        const variants = transparent && spec.transparentVariants ? spec.transparentVariants : spec.variants;
        const variantSpec = variants[Math.max(0, Math.min(variants.length - 1, variantIndex))];
        if (!variantSpec) return undefined;

        const data = this.clone(source);
        data.resize(variantSpec.scale[0], variantSpec.scale[1], variantSpec.scale[2]);
        data.translate(variantSpec.translate[0], variantSpec.translate[1], variantSpec.translate[2]);
        for (const [faceIndex, colour] of variantSpec.recolors) {
            data.recolor(data.faceColors[faceIndex], colour);
        }
        if (variantSpec.rotation === 90) data.rotate90();
        else if (variantSpec.rotation === 180) data.rotate180();
        else if (variantSpec.rotation === 270) data.rotate270();

        const light = variantSpec.light ?? { ambient: DEFAULT_AMBIENT, contrast: DEFAULT_CONTRAST };
        const model = data.light(
            this.textureLoader,
            light.ambient,
            light.contrast,
            DEFAULT_LIGHT_X,
            DEFAULT_LIGHT_Y,
            DEFAULT_LIGHT_Z,
        );
        if (variantSpec.alphaFill !== undefined) {
            model.faceAlphas = new Int8Array(model.faceCount).fill(variantSpec.alphaFill);
        }
        return model;
    }

    /** A copy of `base` posed at `frameIndex`, or undefined when the frame is missing. */
    buildFrame(base: Model, weather: Weather, frameIndex: number): Model | undefined {
        const seq = this.getSequence(weather);
        if (!seq || seq.isSkeletalSeq?.() || !seq.frameIds || seq.frameIds.length === 0) {
            return ModelClass.copyAnimated(base, true, true);
        }
        const ids = seq.frameIds;
        const index = ((frameIndex % ids.length) + ids.length) % ids.length;
        const seqFrame = this.seqFrameLoader.load(ids[index]);
        if (!seqFrame) return undefined;
        const model = ModelClass.copyAnimated(base, !seqFrame.hasAlphaTransform, !seqFrame.hasColorTransform);
        model.animate(seqFrame, undefined, !!seq.op14);
        return model;
    }

    /** GPU-ready triangles for a posed model, cached by weather/variant/transparency/frame. */
    getGeometry(
        weather: Weather,
        variantIndex: number,
        transparent: boolean,
        frameIndex: number,
    ): WeatherGeometry | undefined {
        const key = `${weather}|${variantIndex}|${transparent ? 1 : 0}|${frameIndex}`;
        const cached = this.geometryCache.get(key);
        if (cached) return cached;
        const base = this.buildBase(weather, variantIndex, transparent);
        if (!base) return undefined;
        const posed = this.buildFrame(base, weather, frameIndex);
        if (!posed) return undefined;
        const geometry = buildGeometry(posed);
        if (!geometry) return undefined;
        this.geometryCache.set(key, geometry);
        return geometry;
    }

    private clone(source: ModelData): ModelData {
        const copy = new ModelData();
        copy.copyFrom(source, false, false, false, false);
        return copy;
    }
}

/** Flattens a lit/posed model into interleaved position + colour + index arrays. */
export function buildGeometry(model: Model): WeatherGeometry | undefined {
    const faces = getModelFaces(model);
    if (faces.length === 0) return undefined;
    const positions = new Float32Array(faces.length * 9);
    const colors = new Uint8Array(faces.length * 12);
    const indices = new Uint32Array(faces.length * 3);
    let vertex = 0;
    for (const face of faces) {
        const index = face.index;
        const rgb = hslToRgb(model.faceColors1[index]);
        const r = (rgb >> 16) & 0xff;
        const g = (rgb >> 8) & 0xff;
        const b = rgb & 0xff;
        const alpha = face.alpha;
        const faceIndices = [model.indices1[index], model.indices2[index], model.indices3[index]];
        for (const vertexIndex of faceIndices) {
            const positionOffset = vertex * 3;
            positions[positionOffset] = model.verticesX[vertexIndex];
            positions[positionOffset + 1] = model.verticesY[vertexIndex];
            positions[positionOffset + 2] = model.verticesZ[vertexIndex];
            const colorOffset = vertex * 4;
            colors[colorOffset] = r;
            colors[colorOffset + 1] = g;
            colors[colorOffset + 2] = b;
            colors[colorOffset + 3] = alpha;
            indices[vertex] = vertex;
            vertex++;
        }
    }
    return { positions, colors, indices };
}
