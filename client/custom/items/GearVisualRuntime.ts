import type { TextureLoader } from "../../rs/texture/TextureLoader";
import { GearTextureLoader } from "./GearTextureLoader";
import { GearVisualRegistry, isGearTextureId } from "./GearVisualRegistry";

type UploadTextures = (textures: Map<number, Int32Array>) => void;
type GearTextureTarget = { loadedTextureIds: Set<number> } & (
    { textureArray?: object; updateTextureArray: UploadTextures } |
    { uploadMapTextures: UploadTextures }
);

const uploaded = new WeakMap<GearTextureTarget, Map<number, Int32Array>>();
const modelTextures = new WeakMap<Int16Array, number[]>();
const transparent = new Int32Array(128 * 128);
const noTextures: readonly number[] = [];

export function getModelGearTextures(faceTextures: Int16Array | undefined): readonly number[] {
    if (!faceTextures) return noTextures;
    let ids = modelTextures.get(faceTextures);
    if (!ids) {
        ids = [...new Set(faceTextures.filter(isGearTextureId))];
        modelTextures.set(faceTextures, ids);
    }
    return ids;
}

/** Refresh reserved layers immediately before drawing a mesh that uses them. */
export function updateGearVisuals(
    target: GearTextureTarget,
    loader: TextureLoader,
    visible: readonly number[],
): void {
    if (!visible.length || !(loader instanceof GearTextureLoader)) return;
    if ("updateTextureArray" in target && !target.textureArray) return;
    let previous = uploaded.get(target);
    if (!previous) uploaded.set(target, previous = new Map());
    let changed: Map<number, Int32Array> | undefined;
    for (const id of visible) {
        const pixels = GearVisualRegistry.texturePixel(id, loader.base) ?? transparent;
        if (previous.get(id) === pixels && target.loadedTextureIds.has(id)) continue;
        (changed ??= new Map()).set(id, pixels);
        target.loadedTextureIds.delete(id);
    }
    if (!changed) return;
    if ("uploadMapTextures" in target) target.uploadMapTextures(changed);
    else target.updateTextureArray(changed);
    for (const [id, pixels] of changed) {
        if (target.loadedTextureIds.has(id)) previous.set(id, pixels);
    }
}
