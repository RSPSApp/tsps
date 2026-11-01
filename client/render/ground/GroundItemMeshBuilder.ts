import { vec3 } from "gl-matrix";

import { ObjModelLoader } from "../../rs/config/objtype/ObjModelLoader";
import { Scene } from "../../rs/scene/Scene";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import type { ClientGroundItemStack } from "../../game/data/ground/GroundItemStore";
import { resolveHeightSamplePlaneForLocal } from "../../game/scene/PlaneResolver";
import { DrawRange } from "../DrawRange";
import { InteractType } from "../InteractType";
import type { TileFlagMapSquare } from "../../game/scene/TileRenderFlags";
import {
    ContourGroundType,
    type DrawCommand,
    type ModelInfo,
    SceneBuffer,
    createModelInfoTextureData,
    getModelFacesFiltered,
} from "../buffer/SceneBuffer";

export type GroundItemGeometryBuildData = {
    vertices: Uint8Array;
    indices: Int32Array;
    drawRanges: DrawRange[];
    drawRangesAlpha: DrawRange[];
    drawRangesLod: DrawRange[];
    drawRangesLodAlpha: DrawRange[];
    drawRangesInteract: DrawRange[];
    drawRangesInteractAlpha: DrawRange[];
    drawRangesInteractLod: DrawRange[];
    drawRangesInteractLodAlpha: DrawRange[];
    planes: {
        main: Uint8Array;
        alpha: Uint8Array;
        lod: Uint8Array;
        lodAlpha: Uint8Array;
        interact: Uint8Array;
        interactAlpha: Uint8Array;
        interactLod: Uint8Array;
        interactLodAlpha: Uint8Array;
    };
    modelTextureData: Uint16Array;
    modelTextureDataAlpha: Uint16Array;
    modelTextureDataLod: Uint16Array;
    modelTextureDataLodAlpha: Uint16Array;
    modelTextureDataInteract: Uint16Array;
    modelTextureDataInteractAlpha: Uint16Array;
    modelTextureDataInteractLod: Uint16Array;
    modelTextureDataInteractLodAlpha: Uint16Array;
    usedTextureIds: Set<number>;
};

const tempVec = vec3.create();

function buildDrawRanges(sceneBuf: SceneBuffer, drawCommands: DrawCommand[]): {
    ranges: DrawRange[];
    planes: Uint8Array;
} {
    const planes = new Uint8Array(drawCommands.length);
    const ranges = drawCommands.map((cmd, idx) => {
        const plane = cmd.instances[0].planeCullLevel ?? cmd.instances[0].level;
        planes[idx] = plane & 0xff;
        return sceneBuf.createDrawRange(cmd);
    });
    return { ranges, planes };
}

function pushDrawCommand(
    collections: DrawCommand[][],
    offset: number,
    elements: number,
    info: ModelInfo,
): void {
    if (elements <= 0) {
        return;
    }
    const cmd: DrawCommand = {
        offset,
        elements,
        instances: [info],
    };
    for (const target of collections) {
        target.push(cmd);
    }
}

function cloneStack(stack: ClientGroundItemStack): ClientGroundItemStack {
    return {
        ...stack,
        tile: { x: stack.tile.x | 0, y: stack.tile.y | 0, level: stack.tile.level | 0 },
    };
}

export function buildGroundItemGeometry(
    map: TileFlagMapSquare,
    stacks: ClientGroundItemStack[] | undefined,
    objModelLoader: ObjModelLoader,
    textureLoader: TextureLoader,
    textureIdIndexMap: Map<number, number>,
): GroundItemGeometryBuildData | undefined {
    if (!stacks || stacks.length === 0) {
        return undefined;
    }
    const filtered = stacks
        .map(cloneStack)
        .filter((stack) => stack.tile && typeof stack.tile.level === "number");
    if (!filtered.length) {
        return undefined;
    }

    const sceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, filtered.length * 64);
    // Relative to where the map is drawn (an instance scene's base), matching u_mapPos.
    const mapBaseX = map.getRenderBaseTileX?.() ?? map.mapX * Scene.MAP_SQUARE_SIZE;
    const mapBaseY = map.getRenderBaseTileY?.() ?? map.mapY * Scene.MAP_SQUARE_SIZE;
    const span = map.getLocalTileSpan?.() || Scene.MAP_SQUARE_SIZE;

    for (const stack of filtered) {
        const localX = (stack.tile.x | 0) - mapBaseX;
        const localY = (stack.tile.y | 0) - mapBaseY;
        if (localX < 0 || localX >= span) continue;
        if (localY < 0 || localY >= span) continue;

        const model = objModelLoader.getModel(stack.itemId | 0, stack.quantity | 0);
        if (!model) continue;

        const basePlane = stack.tile.level | 0;
        // Resolve bridge-aware plane for height sampling (same as NPCs/projectiles)
        const heightSamplePlane = resolveHeightSamplePlaneForLocal(map, basePlane, localX, localY);
        const sceneX = localX * 128 + 64;
        const sceneZ = localY * 128 + 64;
        vec3.set(tempVec, 0, 0, 0);

        const info: ModelInfo = {
            sceneX,
            sceneZ,
            heightOffset: map.getObjSurfaceHeight?.(heightSamplePlane, localX, localY) ?? 0,
            level: heightSamplePlane,
            planeCullLevel: basePlane,
            contourGround: ContourGroundType.CENTER_TILE,
            priority: 10,
            interactType: InteractType.OBJ,
            interactId: stack.id | 0,
        };

        const opaqueOffset = sceneBuf.indexByteOffset();
        const opaqueFaces = getModelFacesFiltered(model, textureLoader, false);
        sceneBuf.addModel(model, opaqueFaces, tempVec, false);
        const opaqueElements = (sceneBuf.indexByteOffset() - opaqueOffset) / 4;
        if (opaqueElements > 0) {
            pushDrawCommand(
                [
                    sceneBuf.drawCommands,
                    sceneBuf.drawCommandsLod,
                    sceneBuf.drawCommandsInteract,
                    sceneBuf.drawCommandsInteractLod,
                ],
                opaqueOffset,
                opaqueElements,
                info,
            );
        }

        const alphaFaces = getModelFacesFiltered(model, textureLoader, true);
        if (alphaFaces.length > 0) {
            const alphaOffset = sceneBuf.indexByteOffset();
            sceneBuf.addModel(model, alphaFaces, tempVec, false);
            const alphaElements = (sceneBuf.indexByteOffset() - alphaOffset) / 4;
            pushDrawCommand(
                [
                    sceneBuf.drawCommandsAlpha,
                    sceneBuf.drawCommandsLodAlpha,
                    sceneBuf.drawCommandsInteractAlpha,
                    sceneBuf.drawCommandsInteractLodAlpha,
                ],
                alphaOffset,
                alphaElements,
                info,
            );
        }
    }

    if (sceneBuf.vertexCount() === 0) {
        return undefined;
    }

    const { ranges: drawRanges, planes: drawRangesPlanes } = buildDrawRanges(sceneBuf, sceneBuf.drawCommands);
    const { ranges: drawRangesAlpha, planes: drawRangesAlphaPlanes } = buildDrawRanges(
        sceneBuf, sceneBuf.drawCommandsAlpha,
    );
    const { ranges: drawRangesLod, planes: drawRangesLodPlanes } = buildDrawRanges(
        sceneBuf, sceneBuf.drawCommandsLod,
    );
    const { ranges: drawRangesLodAlpha, planes: drawRangesLodAlphaPlanes } = buildDrawRanges(
        sceneBuf, sceneBuf.drawCommandsLodAlpha,
    );
    const { ranges: drawRangesInteract, planes: drawRangesInteractPlanes } = buildDrawRanges(
        sceneBuf, sceneBuf.drawCommandsInteract,
    );
    const { ranges: drawRangesInteractAlpha, planes: drawRangesInteractAlphaPlanes } =
        buildDrawRanges(sceneBuf, sceneBuf.drawCommandsInteractAlpha);
    const { ranges: drawRangesInteractLod, planes: drawRangesInteractLodPlanes } = buildDrawRanges(
        sceneBuf, sceneBuf.drawCommandsInteractLod,
    );
    const { ranges: drawRangesInteractLodAlpha, planes: drawRangesInteractLodAlphaPlanes } =
        buildDrawRanges(sceneBuf, sceneBuf.drawCommandsInteractLodAlpha);

    return {
        vertices: sceneBuf.vertexBuf.byteArray(),
        indices: new Int32Array(sceneBuf.indices),
        drawRanges,
        drawRangesAlpha,
        drawRangesLod,
        drawRangesLodAlpha,
        drawRangesInteract,
        drawRangesInteractAlpha,
        drawRangesInteractLod,
        drawRangesInteractLodAlpha,
        planes: {
            main: drawRangesPlanes,
            alpha: drawRangesAlphaPlanes,
            lod: drawRangesLodPlanes,
            lodAlpha: drawRangesLodAlphaPlanes,
            interact: drawRangesInteractPlanes,
            interactAlpha: drawRangesInteractAlphaPlanes,
            interactLod: drawRangesInteractLodPlanes,
            interactLodAlpha: drawRangesInteractLodAlphaPlanes,
        },
        modelTextureData: createModelInfoTextureData(sceneBuf.drawCommands),
        modelTextureDataAlpha: createModelInfoTextureData(sceneBuf.drawCommandsAlpha),
        modelTextureDataLod: createModelInfoTextureData(sceneBuf.drawCommandsLod),
        modelTextureDataLodAlpha: createModelInfoTextureData(sceneBuf.drawCommandsLodAlpha),
        modelTextureDataInteract: createModelInfoTextureData(sceneBuf.drawCommandsInteract),
        modelTextureDataInteractAlpha: createModelInfoTextureData(
            sceneBuf.drawCommandsInteractAlpha,
        ),
        modelTextureDataInteractLod: createModelInfoTextureData(sceneBuf.drawCommandsInteractLod),
        modelTextureDataInteractLodAlpha: createModelInfoTextureData(
            sceneBuf.drawCommandsInteractLodAlpha,
        ),
        usedTextureIds: new Set(sceneBuf.usedTextureIds),
    };
}
