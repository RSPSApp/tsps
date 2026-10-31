import type { OsrsClient } from "../../game/OsrsClient";
import { LocModelLoader } from "../../rs/config/loctype/LocModelLoader";
import { NpcModelLoader } from "../../rs/config/npctype/NpcModelLoader";
import { ObjModelLoader } from "../../rs/config/objtype/ObjModelLoader";
import { LocModelType } from "../../rs/config/loctype/LocModelType";
import { Model } from "../../rs/model/Model";
import { Model2DRenderer } from "../../ui/model/Model2DRenderer";
import type { CacheDefinition } from "./CacheEditorModel";

/**
 * Previews for the cache editor, drawn with the client's own software model renderer.
 *
 * A definition is a *list* of model ids plus recolours, so the parts are merged first and then drawn
 * as one model - that is what makes a loc look like a loc and not like three loose planks. Sequence
 * playback reuses the same renderer's `sequenceId`/`sequenceFrame`, so an animated graphic shows a
 * frame rather than a still of its first part.
 */

export type PreviewSpec = {
    modelIds: number[];
    sequenceId?: number;
    sequenceFrame?: number;
    /** Reshape hints a definition carries (zoom, rotation, offsets). */
    zoom2d?: number;
    xan2d?: number;
    yan2d?: number;
    zan2d?: number;
    offsetX2d?: number;
    offsetY2d?: number;
    ambient?: number;
    contrast?: number;
};

const numbers = (value: unknown): number[] =>
    (Array.isArray(value) ? value : [value]).filter((entry): entry is number => Number.isInteger(entry) && (entry as number) >= 0);

/** The models a definition draws, in order, per kind. Locs carry them grouped, npcs and items flat. */
export function previewModels(definition: CacheDefinition, kind = definition.kind): number[] {
    const values = definition.values ?? {};
    if (kind === "loc") {
        // `models` is already flattened by the server's field reader.
        return numbers(values.models ?? []);
    }
    if (kind === "npc") {
        return numbers(values.modelIds ?? values.models ?? []);
    }
    if (kind === "item") {
        return numbers([values.model, values.maleModel, values.femaleModel].filter((entry) => entry !== undefined));
    }
    if (kind === "spotanim") {
        return numbers(values.modelId ?? []);
    }
    return [];
}

/** A preview spec from a definition: what to draw, how it is oriented, and which frame. */
export function previewSpec(definition: CacheDefinition, kind = definition.kind, frame = 0): PreviewSpec | null {
    const values = definition.values ?? {};
    const modelIds = previewModels(definition, kind);
    if (!modelIds.length) return null;
    const asNumber = (value: unknown) => (Number.isInteger(value) ? (value as number) : undefined);
    // A spotanim's `animationId` is a sequence; a loc's `seqId` and an npc's `idleSeqId` are too.
    const sequenceId = asNumber(values.animationId) ?? asNumber(values.seqId) ?? asNumber(values.idleSeqId);
    return {
        modelIds,
        ...(sequenceId !== undefined && sequenceId >= 0 ? { sequenceId, sequenceFrame: frame } : {}),
        ...(asNumber(values.zoom2d) !== undefined ? { zoom2d: asNumber(values.zoom2d) } : {}),
        ...(asNumber(values.xan2d) !== undefined ? { xan2d: asNumber(values.xan2d) } : {}),
        ...(asNumber(values.yan2d) !== undefined ? { yan2d: asNumber(values.yan2d) } : {}),
        ...(asNumber(values.zan2d) !== undefined ? { zan2d: asNumber(values.zan2d) } : {}),
        ...(asNumber(values.offsetX2d) !== undefined ? { offsetX2d: asNumber(values.offsetX2d) } : {}),
        ...(asNumber(values.offsetY2d) !== undefined ? { offsetY2d: asNumber(values.offsetY2d) } : {}),
        ...(asNumber(values.ambient) !== undefined ? { ambient: asNumber(values.ambient) } : {}),
        ...(asNumber(values.contrast) !== undefined ? { contrast: asNumber(values.contrast) } : {}),
    };
}

/** How many frames a sequence has, when the client can read it. */
export function sequenceFrameCount(client: OsrsClient, sequenceId: number | undefined): number {
    if (sequenceId === undefined || sequenceId < 0) return 1;
    try {
        const sequence = client.seqTypeLoader?.load?.(sequenceId);
        return Math.max(1, sequence?.frameIds?.length ?? 1);
    } catch {
        return 1;
    }
}

/**
 * How a loc is drawn. A loc is not "a model": its `models` are grouped by `types`, and which group is
 * drawn depends on the shape it is placed as (`LocModelType`), with mirroring, model resize and offsets
 * applied by `LocModelLoader`. A centrepiece and the same loc placed as a wall are different geometry.
 */
export type LocShapeOption = { type: LocModelType; label: string };

export type PreviewRequest = {
    kind: string;
    id: number;
    spec: PreviewSpec | null;
    /** For locs: which placement shape to draw, and which quarter-turn. */
    shape?: LocModelType;
    rotation?: number;
    /** Drag-to-orbit: degrees added to the definition's own orientation. */
    yaw?: number;
    pitch?: number;
    /** Wheel zoom, multiplied into the auto-fit scale. */
    zoom?: number;
};

const SHAPE_LABELS: Partial<Record<LocModelType, string>> = {
    [LocModelType.WALL]: "wall",
    [LocModelType.WALL_CORNER]: "wall corner",
    [LocModelType.WALL_DECORATION_INSIDE]: "wall decoration (inside)",
    [LocModelType.WALL_DECORATION_OUTSIDE]: "wall decoration (outside)",
    [LocModelType.NORMAL]: "centrepiece",
    [LocModelType.NORMAL_DIAGIONAL]: "diagonal",
    [LocModelType.ROOF_SLOPED]: "roof (sloped)",
    [LocModelType.ROOF_FLAT]: "roof (flat)",
    [LocModelType.FLOOR_DECORATION]: "floor decoration",
};

export const shapeLabel = (type: LocModelType): string => SHAPE_LABELS[type] ?? `shape ${type}`;

/**
 * Crops a rendered model to its non-empty pixels and scales it to fill `size`, centred. Keeps the
 * aspect ratio, leaves a small margin, and supersamples by the device pixel ratio so edges are not
 * soft on a retina display.
 */
function fitToCanvas(source: HTMLCanvasElement, size: number, zoom = 1): { canvas: HTMLCanvasElement; width: number; height: number } | null {
    if (typeof document === "undefined") return null;
    const sourceContext = source.getContext("2d");
    if (!sourceContext || !source.width || !source.height) return null;
    let pixels: ImageData;
    try {
        pixels = sourceContext.getImageData(0, 0, source.width, source.height);
    } catch {
        // A tainted canvas cannot be read; draw it untrimmed rather than fail.
        return { canvas: source, width: source.width, height: source.height };
    }
    let minX = source.width;
    let minY = source.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < source.height; y++) {
        for (let x = 0; x < source.width; x++) {
            if (pixels.data[(y * source.width + x) * 4 + 3] < 8) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < minX || maxY < minY) return null;
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const ratio = Math.min(1, Math.max(1, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));
    const padding = Math.max(4, Math.round(size * 0.06));
    const available = size - padding * 2;
    const scale = Math.min(available / width, available / height) * Math.max(0.25, Math.min(8, zoom));
    const canvas = document.createElement("canvas");
    const target = Math.max(1, Math.round(size * ratio));
    canvas.width = target;
    canvas.height = target;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.drawImage(
        source,
        minX, minY, width, height,
        Math.round(((size - width * scale) / 2) * ratio),
        Math.round(((size - height * scale) / 2) * ratio),
        Math.round(width * scale * ratio),
        Math.round(height * scale * ratio),
    );
    return { canvas, width: target, height: target };
}

export type PreviewRenderer = {
    /** Draws a request into the canvas, or explains why it cannot. */
    draw(canvas: HTMLCanvasElement, request: PreviewRequest, size?: number): string | null;
    /** The placement shapes this loc actually carries models for, so the picker offers only those. */
    locShapes(id: number): LocShapeOption[];
};

/**
 * Builds a renderer once per client. The renderer is a plain software rasteriser, so it needs no WebGL
 * context and works on the editor page, which never enters the game render loop.
 */
export function createPreviewRenderer(client: OsrsClient): PreviewRenderer {
    const renderer = new Model2DRenderer(
        client.objTypeLoader,
        client.modelLoader,
        client.textureLoader,
        client.seqTypeLoader,
        client.seqFrameLoader,
        client.skeletalSeqLoader,
    );

    function merge(modelIds: readonly number[]): Model | null {
        const parts: Model[] = [];
        for (const id of modelIds) {
            try {
                const model = client.modelLoader.getModel(id);
                if (model) parts.push(model as unknown as Model);
            } catch {
                // A missing model is the caller's answer, not a crash.
            }
        }
        if (!parts.length) return null;
        if (parts.length === 1) return parts[0];
        try {
            return Model.merge(parts, parts.length);
        } catch {
            return parts[0];
        }
    }

    const locModels = new LocModelLoader(
        client.locTypeLoader, client.modelLoader, client.textureLoader,
        client.seqTypeLoader, client.seqFrameLoader, client.skeletalSeqLoader,
    );

    /** A loc id resolved through the client's own cache, or null when the cache has no such loc. */
    function locTypeOf(id: number) {
        try {
            return client.locTypeLoader?.load?.(id);
        } catch {
            return undefined;
        }
    }

    return {
        locShapes(id) {
            const type = locTypeOf(id);
            const types: LocModelType[] = type?.types?.length ? [...type.types] : [LocModelType.NORMAL];
            return types.map((entry) => ({ type: entry, label: shapeLabel(entry) }));
        },
        draw(canvas, { kind, id, spec, shape = LocModelType.NORMAL, rotation = 0, yaw = 0, pitch = 0, zoom = 1 }, size = 320) {
            if (!client.objTypeLoader || !client.modelLoader) return "Waiting for the cache to load…";
            const context = canvas.getContext("2d");
            if (!context) return "This browser cannot draw a 2D canvas";
            canvas.width = size;
            canvas.height = size;
            context.clearRect(0, 0, size, size);
            if (!spec) return "This definition has no models to draw";
            // 2048 angle units per turn, the same units a definition stores.
            const turn = 2048 / 360;
            const orbitYaw = Math.round(yaw * turn) & 2047;
            const orbitPitch = Math.round(pitch * turn) & 2047;
            // Render at 2x and let the fit shrink it: a floor decoration is a few pixels tall, and
            // scaling that straight up is what made the trapdoor blocky.
            const renderSize = Math.min(1024, size * 2);
            // Each kind has its own builder in the client, and each differs: a loc's geometry depends
            // on the shape it is placed as, an npc's on its stance animations and transforms, an item's
            // on its model plus recolours, and a graphic's on its model plus a sequence frame.
            let model: Model | null = null;
            if (kind === "npc") {
                try {
                    const npcType = client.npcTypeLoader?.load?.(id);
                    if (npcType) {
                        const npcModels = new NpcModelLoader(
                            client.npcTypeLoader, client.modelLoader, client.textureLoader,
                            client.seqTypeLoader, client.seqFrameLoader, client.skeletalSeqLoader,
                            client.varManager,
                        );
                        model = npcModels.getModel(npcType, spec.sequenceId ?? -1, spec.sequenceFrame ?? 0) ?? null;
                    }
                } catch (error) {
                    return `Could not build npc ${id}: ${String((error as Error).message ?? error)}`;
                }
            } else if (kind === "spotanim") {
                // A graphic is one model plus a sequence; the renderer applies the frame below.
                model = merge(spec.modelIds);
                if (!model) return `Graphic ${id} has no model`;
            } else if (kind === "item") {
                try {
                    const objModels = new ObjModelLoader(client.objTypeLoader, client.modelLoader, client.textureLoader);
                    model = objModels.getModel(id, 1) ?? null;
                } catch (error) {
                    return `Could not build item ${id}: ${String((error as Error).message ?? error)}`;
                }
            } else if (kind === "loc") {
                const type = locTypeOf(id);
                if (type) {
                    try {
                        model = (locModels.getModel(type, shape, rotation) as unknown as Model) ?? null;
                    } catch (error) {
                        return `Could not build loc ${id} as ${shapeLabel(shape)}: ${String((error as Error).message ?? error)}`;
                    }
                    if (!model) return `Loc ${id} has no model for ${shapeLabel(shape)}`;
                }
            }
            model ??= merge(spec.modelIds);
            if (!model) return `Model ${spec.modelIds[0]} is not in the cache's model archive`;
            try {
                const drawn = renderer.renderModelInstanceToCanvasWidget(
                    model,
                    {
                        xan2d: (spec.xan2d ?? 0) + orbitPitch,
                        yan2d: (spec.yan2d ?? 0) + orbitYaw,
                        zan2d: spec.zan2d,
                        zoom2d: spec.zoom2d ?? 1800,
                        offsetX2d: spec.offsetX2d, offsetY2d: spec.offsetY2d,
                        ambient: spec.ambient, contrast: spec.contrast,
                        sequenceId: spec.sequenceId, sequenceFrame: spec.sequenceFrame,
                    },
                    renderSize,
                    renderSize,
                );
                if (!drawn?.canvas) return "The model renderer returned nothing";
                // A definition's own zoom is tuned for the inventory icon or the world, so a monkey or
                // a wall would sit in a corner of the canvas. Crop to the drawn pixels and scale that
                // to fill the panel instead of trusting any per-kind default.
                const fitted = fitToCanvas(drawn.canvas, size, zoom);
                if (!fitted) return "The model drew nothing";
                context.canvas.width = fitted.width;
                context.canvas.height = fitted.height;
                context.canvas.style.width = `${size}px`;
                context.canvas.style.height = `${size}px`;
                context.drawImage(fitted.canvas, 0, 0);
                return null;
            } catch (error) {
                return `Could not draw model ${spec.modelIds[0]}: ${String((error as Error).message ?? error)}`;
            }
        },
    };
}
