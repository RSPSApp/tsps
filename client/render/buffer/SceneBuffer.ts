import { vec3 } from "gl-matrix";

import { Model, computeTextureCoords } from "../../rs/model/Model";
import { Scene } from "../../rs/scene/Scene";
import { SceneTile } from "../../rs/scene/SceneTile";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import { HSL_RGB_MAP, INVALID_HSL_COLOR, packHsl } from "../../rs/util/ColorUtil";
import { clamp } from "../../common/utils/MathUtil";
import { addTerrainCell, addFarTerrainChunk, SCENERY_CHUNK_SIZE } from "../loader/FarScene";
import { DrawRange, newDrawRange } from "../DrawRange";
import { InteractType } from "../InteractType";
import { LocAnimatedData } from "../loc/LocAnimatedData";
import { LocAnimatedGroup } from "../loc/LocAnimatedGroup";
import { SceneLocEntity } from "../loc/SceneLocEntity";
import { VertexBuffer } from "./VertexBuffer";
import { hdGroundMaterial } from "../../game/plugins/hd/HdGroundMaterials";
import { isHdLightSourceFace } from "../../game/plugins/hd/HdLights";
import { ACTOR_VERTEX_STRIDE, buildActorNormals } from "./ActorNormals";

export enum ContourGroundType {
    CENTER_TILE = 0,
    VERTEX = 1,
    NONE = 2,
    TERRAIN = 3, // Already positioned, with baked smooth vertex lighting.
}

export type ModelInfo = {
    // Roof undersides must occlude the sky when viewed below the eaves.
    doubleSided?: boolean;
    sceneX: number;
    sceneZ: number;
    heightOffset: number;
    level: number;
    planeCullLevel?: number; // Original physical level before bridge demotion, for roof/plane culling
    contourGround: ContourGroundType;
    priority: number;
    interactType: InteractType;
    interactId: number;
};

export type DrawCommand = {
    offset: number;
    elements: number;
    instances: ModelInfo[];
    chunk?: [number, number];
};

export type SceneModel = {
    model: Model;
    // ModelData can bake contouring directly into verticesY before lighting,
    // leaving contourVerticesY unset. Keep that classification for far meshes.
    groundConforming?: boolean;
    sceneHeight: number;
    lowDetail: boolean;
    forceMerge: boolean;
} & ModelInfo;

export type ModelMergeGroup = {
    transparent: boolean;
    lowDetail: boolean;
    level: number;
    priority: number;
    planeCullLevel: number;
    models: SceneModel[];
};

export class SceneBuffer {
    vertexBuf: VertexBuffer;
    indices: number[] = [];

    drawCommands: DrawCommand[] = [];
    drawCommandsAlpha: DrawCommand[] = [];

    drawCommandsLod: DrawCommand[] = [];
    drawCommandsLodAlpha: DrawCommand[] = [];

    drawCommandsInteract: DrawCommand[] = [];
    drawCommandsInteractAlpha: DrawCommand[] = [];

    drawCommandsInteractLod: DrawCommand[] = [];
    drawCommandsInteractLodAlpha: DrawCommand[] = [];

    usedTextureIds = new Set<number>();

    /**
     * Full-heightmap [level][x][y] HD ground recipe grid (0 = none), border included.
     * Populated by addTerrain; the HD terrain shader blends neighbours across tile borders.
     */
    groundMaterials?: Uint8Array[][];

    /** [level][x][y] average colour (0xRRGGBB, 0 = none) of each tile's untextured faces, for ground clutter. */
    groundColors?: Uint32Array[][];

    constructor(
        readonly textureLoader: TextureLoader,
        readonly textureIdIndexMap: Map<number, number>,
        initVertexCount: number,
        readonly smoothActor: boolean = false,
    ) {
        this.vertexBuf = new VertexBuffer(initVertexCount, smoothActor ? ACTOR_VERTEX_STRIDE : VertexBuffer.STRIDE);
    }

    vertexCount(): number {
        return this.vertexBuf.offset;
    }

    indexByteOffset(): number {
        return this.indices.length * 4;
    }

    /**
     * Apply color override blending to an HSL color value.
     * Reference: player-animation.md lines 1158-1173
     *
     * @param originalHsl Original HSL color value (packed)
     * @param model Model containing override values
     * @returns Blended HSL color value
     */
    private applyColorOverride(originalHsl: number, model: Model): number {
        if (model.overrideAmount === 0) {
            return originalHsl;
        }

        // Extract original HSL components
        const origHue = (originalHsl >> 10) & 0x3f; // 6 bits
        const origSat = (originalHsl >> 7) & 0x7; // 3 bits
        const origLum = originalHsl & 0x7f; // 7 bits

        // Override components (0-127 range)
        const overHue = model.overrideHue & 0x7f;
        const overSat = model.overrideSaturation & 0x7f;
        const overLum = model.overrideLuminance & 0x7f;

        // Blend amount (0-255, where 255 = full override, 0 = no override)
        const amount = model.overrideAmount & 0xff;

        // Blend each component based on amount
        // amount / 255 gives us the blend factor
        const blendFactor = amount / 255.0;

        // Convert override components to same scale as original
        const overHue6bit = (overHue * 63) / 127; // Convert 0-127 to 0-63
        const overSat3bit = (overSat * 7) / 127; // Convert 0-127 to 0-7
        const overLum7bit = overLum; // Already 0-127, keep as 7-bit

        // Linear blend
        const newHue = Math.round(origHue * (1 - blendFactor) + overHue6bit * blendFactor);
        const newSat = Math.round(origSat * (1 - blendFactor) + overSat3bit * blendFactor);
        const newLum = Math.round(origLum * (1 - blendFactor) + overLum7bit * blendFactor);

        // Clamp to valid ranges
        const finalHue = clamp(newHue, 0, 0x3f);
        const finalSat = clamp(newSat, 0, 0x7);
        const finalLum = clamp(newLum, 0, 0x7f);

        // Pack back into HSL value
        return (finalHue << 10) + (finalSat << 7) + finalLum;
    }

    addTerrainTile(tile: SceneTile, offsetX: number, offsetY: number): void {
        const tileModel = tile.tileModel;
        if (!tileModel) {
            return;
        }
        for (const face of tileModel.faces) {
            const groundMaterial = hdGroundMaterial(
                face.isOverlay ? tileModel.overlayId : tileModel.underlayId,
                face.isOverlay,
                face.isOverlay ? tileModel.overlayHsl : tileModel.blendUnderlayHslSw,
            );
            for (const vertex of face.vertices) {
                const textureIndex = this.textureIdIndexMap.get(vertex.textureId) ?? -1;

                if (textureIndex !== -1) {
                    this.usedTextureIds.add(vertex.textureId);
                }

                const index = this.vertexBuf.addVertex(
                    vertex.x + offsetX,
                    vertex.y,
                    vertex.z + offsetY,
                    vertex.hsl,
                    0xff,
                    // Untextured terrain never samples its cache UVs. Negative
                    // U encodes the HD recipe without changing HSL or priorities.
                    vertex.textureId === -1 ? -groundMaterial / 64 : vertex.u,
                    vertex.v,
                    textureIndex,
                );

                this.indices.push(index);
            }
        }
    }

    private heightBounds: number[][] = [];
    private rangeCache = new WeakMap<DrawCommand, DrawRange>();

    setHeightBounds(scene: Scene): void {
        this.heightBounds = scene.tileHeights.map(columns => {
            let min = Infinity, max = -Infinity;
            for (const column of columns) for (const height of column) {
                min = Math.min(min, height); max = Math.max(max, height);
            }
            return [min, max];
        });
    }

    createDrawRange(command: DrawCommand): DrawRange {
        const cached = this.rangeCache.get(command);
        if (cached) return cached;
        const range = newDrawRange(command.offset, command.elements, command.instances.length);
        // Terrain ranges share identical instance data within each plane, so
        // contiguous visible chunks may be coalesced on the single-draw backend.
        if (command.instances.length === 1 && command.instances[0].contourGround === ContourGroundType.TERRAIN)
            range.batchKey = command.instances[0].level;
        range.chunk = command.chunk ?? [Math.floor(command.instances[0].sceneX / 1024) * 8, Math.floor(command.instances[0].sceneZ / 1024) * 8];
        if (command.elements > 0) {
            const base = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
            for (let i = command.offset / 4; i < command.offset / 4 + command.elements; i++) {
                const offset = this.indices[i] * this.vertexBuf.stride;
                const x = (this.vertexBuf.view.getUint32(offset, true) >>> 17) - 16384;
                const y = 16384 - (this.vertexBuf.view.getUint32(offset + 4, true) & 32767);
                const z = (this.vertexBuf.view.getUint32(offset + 8, true) >>> 17) - 16384;
                base[0] = Math.min(base[0], x); base[1] = Math.min(base[1], y); base[2] = Math.min(base[2], z);
                base[3] = Math.max(base[3], x); base[4] = Math.max(base[4], y); base[5] = Math.max(base[5], z);
            }
            const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
            for (const instance of command.instances) {
                const heights = instance.contourGround < ContourGroundType.NONE ? this.heightBounds[instance.level] ?? [-16384, 16384] : [0, 0];
                const height = Math.round(instance.heightOffset / 8) * 8;
                const shift = [instance.sceneX, -height, instance.sceneZ];
                for (let axis = 0; axis < 3; axis++) {
                    bounds[axis] = Math.min(bounds[axis], (base[axis] + shift[axis] + (axis === 1 ? heights[0] : 0)) / 128 - 0.05);
                    bounds[axis + 3] = Math.max(bounds[axis + 3], (base[axis + 3] + shift[axis] + (axis === 1 ? heights[1] : 0)) / 128 + 0.05);
                }
            }
            range.bounds = bounds;
        }
        this.rangeCache.set(command, range);
        return range;
    }

    appendFarScenery(far: SceneBuffer): void {
        const vertexOffset = this.vertexCount(), indexOffset = this.indexByteOffset();
        this.vertexBuf.ensureSize(far.vertexCount());
        this.vertexBuf.bytes.set(far.vertexBuf.byteArray(), this.vertexBuf.byteOffset());
        this.vertexBuf.offset += far.vertexCount();
        for (const index of far.indices) this.indices.push(index + vertexOffset);
        for (const texture of far.usedTextureIds) this.usedTextureIds.add(texture);
        const commands = (items: DrawCommand[]) => items.map(command => ({ ...command, offset: command.offset + indexOffset }));
        this.drawCommandsLod = commands(far.drawCommands);
        this.drawCommandsLodAlpha = commands(far.drawCommandsAlpha);
    }

    addTerrain(scene: Scene, borderSize: number, maxLevel: number, coreSize: number = Scene.MAP_SQUARE_SIZE, worldTileOffset: number = borderSize): number {
        this.setHeightBounds(scene);
        // The grid covers the whole scene (border included), not just the meshed core, so
        // fragments at the edge of the visible core can still sample their border neighbours.
        this.groundMaterials = buildGroundMaterialGrid(scene);
        this.groundColors = buildGroundColorGrid(scene);
        const before = this.vertexCount(), offset = -worldTileOffset * 128;
        const endX = borderSize + coreSize, endY = borderSize + coreSize;
        for (let level = 0; level < scene.levels; level++) for (let detail = 0; detail < 2; detail++) {
            for (let cx = borderSize; cx < endX; cx += SCENERY_CHUNK_SIZE) for (let cy = borderSize; cy < endY; cy += SCENERY_CHUNK_SIZE) {
                const ex = Math.min(cx + SCENERY_CHUNK_SIZE, endX), ey = Math.min(cy + SCENERY_CHUNK_SIZE, endY);
                const instance: ModelInfo = { sceneX: 0, sceneZ: 0, heightOffset: 0, level,
                    contourGround: ContourGroundType.TERRAIN, priority: 0, interactType: InteractType.NONE, interactId: 0xffff };
                const chunk: [number, number] = [cx - worldTileOffset, cy - worldTileOffset];
                const start = this.indexByteOffset();
                if (detail === 0) {
                    for (let x = cx; x < ex; x++) for (let y = cy; y < ey; y++) addTerrainCell(this, scene, level, x, y, maxLevel, offset);
                } else {
                    addFarTerrainChunk(this, scene, level, cx, cy, ex, ey, maxLevel, offset);
                }
                const command: DrawCommand = { offset: start, elements: (this.indexByteOffset() - start) / 4, instances: [instance], chunk };
                if (command.elements === 0) continue;
                if (detail === 0) {
                    this.drawCommands.push(command); this.drawCommandsInteract.push(command);
                } else {
                    this.drawCommandsLod.push(command); this.drawCommandsInteractLod.push(command);
                }
            }
        }
        return this.vertexCount() - before;
    }

    addModelAnimFrame(
        model: Model,
        transparent: boolean,
        actorNormals?: Uint16Array,
        doubleSided: boolean = false,
        locId: number = -1,
    ): DrawRange {
        // Optimized: filter transparency in single pass instead of getModelFaces() + filter()
        const faces = getModelFacesFiltered(model, this.textureLoader, transparent);

        const offset = this.indexByteOffset();
        this.addModel(model, faces, undefined, true, actorNormals, doubleSided, locId);
        const elements = (this.indexByteOffset() - offset) / 4;

        return newDrawRange(offset, elements, 1);
    }

    addLocAnimatedGroups(groups: Iterable<LocAnimatedGroup>): LocAnimatedData[] {
        const locsAnimated: LocAnimatedData[] = [];

        for (const group of groups) {
            for (const loc of group.locs) {
                locsAnimated.push(this.addLocAnimated(group, loc));
            }
        }

        return locsAnimated;
    }

    addLocAnimated(group: LocAnimatedGroup, loc: SceneLocEntity): LocAnimatedData {
        const anim = group.anim;

        // Normal (merged)
        const drawRangeIndex = this.drawCommands.length;
        this.drawCommands.push({
            offset: 0,
            elements: 0,
            instances: [loc],
        });
        const drawRangeAlphaIndex = this.drawCommandsAlpha.length;
        if (anim.framesAlpha) {
            this.drawCommandsAlpha.push({
                offset: 0,
                elements: 0,
                instances: [loc],
            });
        }
        // Lod (merged)
        let drawRangeLodIndex = -1;
        let drawRangeLodAlphaIndex = -1;
        if (!loc.lowDetail) {
            drawRangeLodIndex = this.drawCommandsLod.length;
            this.drawCommandsLod.push({
                offset: 0,
                elements: 0,
                instances: [loc],
            });
            if (anim.framesAlpha) {
                drawRangeLodAlphaIndex = this.drawCommandsLodAlpha.length;
                this.drawCommandsLodAlpha.push({
                    offset: 0,
                    elements: 0,
                    instances: [loc],
                });
            }
        }

        // Interact (non merged)
        const drawRangeInteractIndex = this.drawCommandsInteract.length;
        this.drawCommandsInteract.push({
            offset: 0,
            elements: 0,
            instances: [loc],
        });
        const drawRangeInteractAlphaIndex = this.drawCommandsInteractAlpha.length;
        if (anim.framesAlpha) {
            this.drawCommandsInteractAlpha.push({
                offset: 0,
                elements: 0,
                instances: [loc],
            });
        }

        // Interact Lod (non merged)
        let drawRangeInteractLodIndex = -1;
        let drawRangeInteractLodAlphaIndex = -1;
        if (!loc.lowDetail) {
            drawRangeInteractLodIndex = this.drawCommandsInteractLod.length;
            this.drawCommandsInteractLod.push({
                offset: 0,
                elements: 0,
                instances: [loc],
            });
            if (anim.framesAlpha) {
                drawRangeInteractLodAlphaIndex = this.drawCommandsInteractLodAlpha.length;
                this.drawCommandsInteractLodAlpha.push({
                    offset: 0,
                    elements: 0,
                    instances: [loc],
                });
            }
        }
        return {
            drawRangeIndex,
            drawRangeAlphaIndex,

            drawRangeLodIndex,
            drawRangeLodAlphaIndex,

            drawRangeInteractIndex,
            drawRangeInteractAlphaIndex,

            drawRangeInteractLodIndex,
            drawRangeInteractLodAlphaIndex,

            anim,
            seqId: loc.entity.seqId,
            randomStart: loc.entity.seqRandomStart,

            // Position and ID for ambient sounds
            locId: loc.interactId,
            x: loc.sceneX,
            y: loc.sceneZ,
            level: loc.level,
            rotation: loc.entity.rotation,
        };
    }

    addModelGroup(group: ModelMergeGroup): void {
        const groupOffset = this.indexByteOffset();

        for (const sceneModel of group.models) {
            const model = sceneModel.model;

            // Optimized: filter transparency in single pass instead of getModelFaces() + filter()
            const faces = getModelFacesFiltered(model, this.textureLoader, group.transparent);

            const vertexOffset: vec3 = [
                sceneModel.sceneX,
                sceneModel.sceneHeight,
                sceneModel.sceneZ,
            ];
            if (sceneModel.heightOffset !== 0) {
                vertexOffset[1] = -sceneModel.heightOffset;
            }
            const offset = this.indexByteOffset();
            this.addModel(model, faces, vertexOffset, true, undefined, sceneModel.doubleSided, sceneModel.interactId);
            const elements = (this.indexByteOffset() - offset) / 4;

            const drawCommand: DrawCommand = {
                offset: offset,
                elements: elements,
                chunk: [Math.floor(sceneModel.sceneX / 1024) * 8, Math.floor(sceneModel.sceneZ / 1024) * 8],
                instances: [
                    {
                        sceneX: 0,
                        sceneZ: 0,
                        heightOffset: 0,
                        level: group.level,
                        planeCullLevel: group.planeCullLevel,
                        contourGround: ContourGroundType.NONE,
                        priority: group.priority,
                        interactType: sceneModel.interactType,
                        interactId: sceneModel.interactId,
                    },
                ],
            };
            if (group.transparent) {
                this.drawCommandsInteractAlpha.push(drawCommand);
                if (!group.lowDetail) {
                    this.drawCommandsInteractLodAlpha.push(drawCommand);
                }
            } else {
                this.drawCommandsInteract.push(drawCommand);
                if (!group.lowDetail) {
                    this.drawCommandsInteractLod.push(drawCommand);
                }
            }
        }

        const groupElements = (this.indexByteOffset() - groupOffset) / 4;

        if (groupElements > 0) {
            const drawCommand: DrawCommand = {
                offset: groupOffset,
                elements: groupElements,
                chunk: [Math.floor(group.models[0].sceneX / 1024) * 8, Math.floor(group.models[0].sceneZ / 1024) * 8],
                instances: [
                    {
                        sceneX: 0,
                        sceneZ: 0,
                        heightOffset: 0,
                        level: group.level,
                        planeCullLevel: group.planeCullLevel,
                        contourGround: ContourGroundType.NONE,
                        priority: group.priority,
                        interactType: InteractType.NONE,
                        interactId: 0xffff,
                    },
                ],
            };

            if (group.transparent) {
                this.drawCommandsAlpha.push(drawCommand);
                if (!group.lowDetail) {
                    this.drawCommandsLodAlpha.push(drawCommand);
                }
            } else {
                this.drawCommands.push(drawCommand);
                if (!group.lowDetail) {
                    this.drawCommandsLod.push(drawCommand);
                }
            }
        }
    }

    addModel(
        model: Model,
        faces: ModelFace[],
        offset?: vec3,
        reuseVertices: boolean = true,
        actorNormals?: Uint16Array,
        doubleSided: boolean = false,
        locId: number = -1,
    ): void {
        if (faces.length === 0) {
            return;
        }

        const verticesX = model.verticesX;
        let verticesY = model.verticesY;
        const verticesZ = model.verticesZ;
        const normals = this.smoothActor ? actorNormals ?? buildActorNormals(model) : undefined;

        let sceneX = 0;
        let sceneZ = 0;
        let sceneHeight = 0;
        if (offset) {
            sceneX = offset[0];
            sceneHeight = offset[1];
            sceneZ = offset[2];
            if (model.contourVerticesY) {
                verticesY = model.contourVerticesY;
            }
        }

        const facesA = model.indices1;
        const facesB = model.indices2;
        const facesC = model.indices3;

        // const modelTexCoords = computeTextureCoords(model);
        const modelTexCoords = model.uvs;

        if (model.faceTextures && !modelTexCoords) {
            throw new Error("Model has face textures but no texture coordinates");
        }

        for (const face of faces) {
            const index = face.index;
            const alpha = face.alpha;
            const priority = face.priority;
            const renderLayer = face.renderLayer;
            const textureId = face.textureId;
            const textureIndex = this.textureIdIndexMap.get(textureId) ?? -1;

            let hslA = model.faceColors1[index];
            let hslB = model.faceColors2[index];
            let hslC = model.faceColors3[index];

            if (hslC === -1) {
                hslC = hslB = hslA;
            }

            // Apply color override (damage/poison/freeze tints)
            // Reference: player-animation.md lines 1158-1166
            if (model.overrideAmount !== 0) {
                hslA = this.applyColorOverride(hslA, model);
                hslB = this.applyColorOverride(hslB, model);
                hslC = this.applyColorOverride(hslC, model);
            }

            let u0: number = 0;
            let v0: number = 0;
            let u1: number = 0;
            let v1: number = 0;
            let u2: number = 0;
            let v2: number = 0;

            if (modelTexCoords) {
                const texCoordIdx = index * 6;
                u0 = modelTexCoords[texCoordIdx];
                v0 = modelTexCoords[texCoordIdx + 1];
                u1 = modelTexCoords[texCoordIdx + 2];
                v1 = modelTexCoords[texCoordIdx + 3];
                u2 = modelTexCoords[texCoordIdx + 4];
                v2 = modelTexCoords[texCoordIdx + 5];

                // emulate wrapS: PicoGL.CLAMP_TO_EDGE
                // u0 = clamp(u0, 0.00390625 * 3, 1 - 0.00390625 * 3);
                // u1 = clamp(u1, 0.00390625 * 3, 1 - 0.00390625 * 3);
                // u2 = clamp(u2, 0.00390625 * 3, 1 - 0.00390625 * 3);
            }

            // Untextured faces have no UV use in vanilla; V=-1 marks HD light-source faces.
            if (textureIndex === -1 && isHdLightSourceFace(locId, model, index)) v0 = v1 = v2 = -1;

            const fa = facesA[index];
            const fb = facesB[index];
            const fc = facesC[index];
            // Keep vanilla shaded colours in the original words. HD actors use
            // the unshaded colour in the fourth word, with live tint overrides.
            let baseHsl = model.faceColors?.[index] ?? (hslA & 0xffff);
            if (model.overrideAmount !== 0) baseHsl = this.applyColorOverride(baseHsl, model);
            baseHsl &= 0xffff;

            const vxa = sceneX + verticesX[fa];
            const vxb = sceneX + verticesX[fb];
            const vxc = sceneX + verticesX[fc];

            const vya = sceneHeight + verticesY[fa];
            const vyb = sceneHeight + verticesY[fb];
            const vyc = sceneHeight + verticesY[fc];

            const vza = sceneZ + verticesZ[fa];
            const vzb = sceneZ + verticesZ[fb];
            const vzc = sceneZ + verticesZ[fc];

            if (textureIndex !== -1) {
                this.usedTextureIds.add(textureId);
            }

            const index0 = this.vertexBuf.addVertex(
                vxa,
                vya,
                vza,
                hslA,
                alpha,
                u0,
                v0,
                textureIndex,
                reuseVertices,
                renderLayer ?? priority,
                renderLayer !== undefined,
                normals ? (normals[fa] << 16) | baseHsl : 0,
            );
            const index1 = this.vertexBuf.addVertex(
                vxb,
                vyb,
                vzb,
                hslB,
                alpha,
                u1,
                v1,
                textureIndex,
                reuseVertices,
                renderLayer ?? priority,
                renderLayer !== undefined,
                normals ? (normals[fb] << 16) | baseHsl : 0,
            );
            const index2 = this.vertexBuf.addVertex(
                vxc,
                vyc,
                vzc,
                hslC,
                alpha,
                u2,
                v2,
                textureIndex,
                reuseVertices,
                renderLayer ?? priority,
                renderLayer !== undefined,
                normals ? (normals[fc] << 16) | baseHsl : 0,
            );

            this.indices.push(index0, index1, index2);
            // Only roofs need an underside. Reuse their packed vertices/UVs;
            // global culling still keeps actors and other scenery single-sided.
            if (doubleSided) this.indices.push(index2, index1, index0);
        }
    }
}

/** HD ground recipe of the tile's dominant face: overlay when it has one, else underlay. */
function tileGroundMaterial(tile: SceneTile | undefined): number {
    const tileModel = tile?.tileModel;
    if (!tileModel || tile.skipRender) {
        return 0;
    }
    let underlayMaterial = 0;
    for (const face of tileModel.faces) {
        const material = hdGroundMaterial(
            face.isOverlay ? tileModel.overlayId : tileModel.underlayId,
            face.isOverlay,
            face.isOverlay ? tileModel.overlayHsl : tileModel.blendUnderlayHslSw,
        );
        if (face.isOverlay) {
            if (material > 0) return material;
        } else if (material > 0) {
            underlayMaterial = material;
        }
    }
    return underlayMaterial;
}

/**
 * [level][x][y] HD ground recipe grid over the scene's full heightmap (border included).
 * Same coordinate space as heightMapTextureData so the shader can look up tile borders.
 */
function buildGroundMaterialGrid(scene: Scene): Uint8Array[][] {
    const grid: Uint8Array[][] = new Array(Scene.MAX_LEVELS);
    for (let level = 0; level < Scene.MAX_LEVELS; level++) {
        const columns: Uint8Array[] = new Array(scene.sizeX);
        for (let x = 0; x < scene.sizeX; x++) {
            const column = new Uint8Array(scene.sizeY);
            for (let y = 0; y < scene.sizeY; y++) {
                column[y] = tileGroundMaterial(scene.tiles[level]?.[x]?.[y]);
            }
            columns[x] = column;
        }
        grid[level] = columns;
    }
    return grid;
}

/** Average shaded colour of a tile's untextured faces (0xRRGGBB), or 0 when it has none. */
function tileGroundColor(tile: SceneTile | undefined): number {
    const tileModel = tile?.tileModel;
    if (!tileModel || tile.skipRender) return 0;
    let r = 0, g = 0, b = 0, count = 0;
    for (const face of tileModel.faces) {
        for (const vertex of face.vertices) {
            if (vertex.textureId !== -1 || vertex.hsl === INVALID_HSL_COLOR || vertex.hsl < 0) continue;
            const rgb = HSL_RGB_MAP[vertex.hsl & 0xffff];
            r += (rgb >> 16) & 0xff;
            g += (rgb >> 8) & 0xff;
            b += rgb & 0xff;
            count++;
        }
    }
    if (count === 0) return 0;
    // Never 0, which means "no colour".
    return ((Math.round(r / count) << 16) | (Math.round(g / count) << 8) | Math.round(b / count)) || 1;
}

/** [level][x][y] tile colour grid over the scene's full heightmap, like buildGroundMaterialGrid. */
function buildGroundColorGrid(scene: Scene): Uint32Array[][] {
    const grid: Uint32Array[][] = new Array(Scene.MAX_LEVELS);
    for (let level = 0; level < Scene.MAX_LEVELS; level++) {
        const columns: Uint32Array[] = new Array(scene.sizeX);
        for (let x = 0; x < scene.sizeX; x++) {
            const column = new Uint32Array(scene.sizeY);
            for (let y = 0; y < scene.sizeY; y++) column[y] = tileGroundColor(scene.tiles[level]?.[x]?.[y]);
            columns[x] = column;
        }
        grid[level] = columns;
    }
    return grid;
}

export type ModelFace = {
    index: number;
    alpha: number;
    priority: number;
    renderLayer?: number;
    textureId: number;
};

export function isModelFaceTransparent(textureLoader: TextureLoader, face: ModelFace): boolean {
    return (
        face.alpha < 0xff || (face.textureId !== -1 && textureLoader.isTransparent(face.textureId))
    );
}

function faceTransparencyToAlpha(transparency: number): number {
    const value = transparency === -1 ? 253 : transparency & 0xff;
    return clamp(256 - value, 0, 0xff);
}

export function getModelFaces(model: Model): ModelFace[] {
    const faces: ModelFace[] = [];

    const faceTransparencies = model.faceAlphas;

    const priorities = model.faceRenderPriorities;
    const renderLayers = model.faceRenderLayers;

    for (let index = 0; index < model.faceCount; index++) {
        let hslC = model.faceColors3[index];

        if (hslC === -2) {
            continue;
        }

        let textureId = -1;
        if (model.faceTextures) {
            textureId = model.faceTextures[index];
        }

        let alpha = 0xff;
        if (faceTransparencies) {
            alpha = faceTransparencyToAlpha(faceTransparencies[index]);
        }

        // Skip fully transparent faces
        if (alpha === 0) {
            continue;
        }

        let priority = 0;
        if (priorities) {
            priority = priorities[index];
        }

        faces.push({
            index,
            alpha,
            priority,
            renderLayer: renderLayers?.[index],
            textureId,
        });
    }

    return faces;
}

/**
 * Optimized version that filters faces by transparency in a single pass.
 * Avoids double allocation: getModelFaces() + filter()
 */
export function getModelFacesFiltered(
    model: Model,
    textureLoader: TextureLoader,
    transparent: boolean,
): ModelFace[] {
    const faces: ModelFace[] = [];

    const faceTransparencies = model.faceAlphas;
    const priorities = model.faceRenderPriorities;
    const renderLayers = model.faceRenderLayers;

    for (let index = 0; index < model.faceCount; index++) {
        let hslC = model.faceColors3[index];

        if (hslC === -2) {
            continue;
        }

        let textureId = -1;
        if (model.faceTextures) {
            textureId = model.faceTextures[index];
        }

        let alpha = 0xff;
        if (faceTransparencies) {
            alpha = faceTransparencyToAlpha(faceTransparencies[index]);
        }

        // Skip fully transparent faces
        if (alpha === 0) {
            continue;
        }

        // Check transparency and filter in one pass
        const isTransparent =
            alpha < 0xff || (textureId !== -1 && textureLoader.isTransparent(textureId));
        if (isTransparent !== transparent) {
            continue;
        }

        let priority = 0;
        if (priorities) {
            priority = priorities[index];
        }

        faces.push({
            index,
            alpha,
            priority,
            renderLayer: renderLayers?.[index],
            textureId,
        });
    }

    return faces;
}

export function createModelInfoTextureData(drawCommands: DrawCommand[]): Uint16Array {
    const instances: ModelInfo[] = [];
    for (const cmd of drawCommands) {
        instances.push(...cmd.instances);
    }
    const instanceCount = instances.length;

    const dataLength = Math.ceil((drawCommands.length * 4 + instanceCount) / 16) * 16;
    const textureData = new Uint16Array(Math.max(dataLength, 16) * 4);
    let dataOffset = 0;
    drawCommands.forEach((cmd, index) => {
        textureData[index * 4] = drawCommands.length + dataOffset;

        dataOffset += cmd.instances.length;
    });

    instances.forEach((data, index) => {
        let offset = drawCommands.length * 4 + index * 4;

        const contourGround = data.contourGround;

        const height = data.heightOffset;
        const planeCullLevel = data.planeCullLevel ?? data.level;

        textureData[offset++] = data.sceneX | (data.level << 14);
        textureData[offset++] = data.sceneZ | (contourGround << 14);
        textureData[offset++] =
            (data.priority & 0x7) |
            ((data.interactId >> 16) << 3) |
            (data.interactType << 4) |
            (planeCullLevel << 6) |
            (Math.round(height / 8) << 8);
        textureData[offset++] = data.interactId;
    });

    return textureData;
}
