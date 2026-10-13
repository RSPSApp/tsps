import { HD_OBJECT_LIGHTS_BY_ID, type HdObjectLightDefinition } from "./hdObjectLightData";
import type { Model } from "../../../rs/model/Model";

/** Coloured flames/glass near a defined light's height; exclude dark wood and metal. */
export function isHdLightSourceFace(locId: number, model: Model, face: number): boolean {
    const lights = HD_OBJECT_LIGHTS_BY_ID[locId];
    if (!lights || (model.faceTextures?.[face] ?? -1) >= 0) return false;
    const hsl = model.faceColors[face];
    // shortcut: grey source faces need explicit material tags if new lamps use them.
    if (((hsl >> 7) & 7) < 3 || (hsl & 127) < 28) return false;
    const y = (model.verticesY[model.indices1[face]] + model.verticesY[model.indices2[face]]
        + model.verticesY[model.indices3[face]]) / 3;
    return lights.some(light => Math.abs(y + light.height) <= 50);
}

/** The slice of a map square collectHdLights reads, shared by WebGLMapSquare and WebGPUMapSquare. */
export interface HdLightsMap {
    getRenderBaseWorldX(): number;
    getRenderBaseWorldY(): number;
    tileLocOffsetsByLevel?: Uint32Array[];
    tileLocIdsByLevel?: Int32Array[];
    tileLocTypeRotByLevel?: Uint8Array[];
}

/** The slice of a renderer collectHdLights reads; both backends satisfy it. */
export interface HdLightsHost {
    playerPosUni: ArrayLike<number>;
    getPlayerRawPlane(): number;
    sampleHeightAtExactPlane(worldX: number, worldZ: number, plane: number): number;
    mapManager: { visibleMapCount: number; visibleMaps: ReadonlyArray<HdLightsMap> };
    osrsClient: { locTypeLoader: { load(id: number): { sizeX: number; sizeY: number } } };
}

const ABSOLUTE_ALIGNMENTS = ["NORTH", "NORTHEAST", "EAST", "SOUTHEAST", "SOUTH", "SOUTHWEST", "WEST", "NORTHWEST"];
const RELATIVE_ALIGNMENTS = ["BACK", "BACKLEFT", "LEFT", "FRONTLEFT", "FRONT", "FRONTRIGHT", "RIGHT", "BACKRIGHT"];

export function hdLightOffset(alignment: string, rotation: number, width: number, length: number): [number, number] {
    const name = alignment.replace("_CORNER", "");
    const relative = RELATIVE_ALIGNMENTS.indexOf(name);
    const absolute = ABSOLUTE_ALIGNMENTS.indexOf(name);
    if (relative < 0 && absolute < 0) return [0, 0];
    const angle = (relative >= 0 ? relative + rotation * 2 : absolute) * Math.PI / 4;
    const radius = alignment.endsWith("_CORNER") ? Math.hypot(width, length) / 2 : width / 2;
    return [radius * Math.sin(angle), radius * Math.cos(angle) * length / width];
}

export function animateHdLight(light: HdObjectLightDefinition, seed: number, time: number): number {
    const range = Math.max(0, light.range) / 100;
    if (light.type === "PULSE" && light.duration > 0) {
        const phase = ((time + (seed & 2047)) % light.duration) / light.duration;
        return 1 - range + (1 - Math.abs(phase * 2 - 1)) * range * 2;
    }
    if (light.type === "FLICKER") {
        const t = ((time + (seed & 32767)) % 60000) * Math.PI * 2 / 60000;
        const wave = (Math.cos(11 * t) ** 2 + Math.cos(17 * t) ** 4 + Math.cos(23 * t) ** 6 +
            Math.cos(31 * t) ** 2 + Math.cos(71 * t) ** 2 / 3 + Math.cos(151 * t) ** 2 / 7) / 4.335;
        return 1 - range + wave * range * 2;
    }
    return 1;
}

export function collectHdLights(host: HdLightsHost, positions: Float32Array, colors: Float32Array, time: number): number {
    const candidates: Array<{ position: number[]; color: number[]; distance: number }> = [];
    const playerX = host.playerPosUni[0];
    const playerZ = host.playerPosUni[1];
    const plane = host.getPlayerRawPlane();
    for (let m = 0; m < host.mapManager.visibleMapCount; m++) {
        const map = host.mapManager.visibleMaps[m];
        const offsets = map.tileLocOffsetsByLevel?.[plane];
        const ids = map.tileLocIdsByLevel?.[plane];
        const rotations = map.tileLocTypeRotByLevel?.[plane];
        if (!offsets || !ids) continue;
        const baseX = map.getRenderBaseWorldX();
        const baseZ = map.getRenderBaseWorldY();
        const minX = Math.max(0, Math.floor(playerX - baseX - 16));
        const maxX = Math.min(63, Math.ceil(playerX - baseX + 16));
        const minZ = Math.max(0, Math.floor(playerZ - baseZ - 16));
        const maxZ = Math.min(63, Math.ceil(playerZ - baseZ + 16));
        for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
            const tile = z * 64 + x;
            for (let i = offsets[tile]; i < offsets[tile + 1]; i++) {
                const definitions = HD_OBJECT_LIGHTS_BY_ID[ids[i]];
                if (!definitions) continue;
                const loc = host.osrsClient.locTypeLoader.load(ids[i]);
                const rotation = (rotations?.[i] ?? 0) >> 6;
                const width = rotation & 1 ? loc.sizeY : loc.sizeX;
                const length = rotation & 1 ? loc.sizeX : loc.sizeY;
                for (const light of definitions) {
                    const [offsetX, offsetZ] = hdLightOffset(light.alignment, rotation, width, length);
                    const lx = baseX + x + width / 2 + offsetX;
                    const lz = baseZ + z + length / 2 + offsetZ;
                    const height = host.sampleHeightAtExactPlane(lx, lz, plane);
                    const animation = animateHdLight(light, ids[i] ^ (x << 7) ^ z, time);
                    candidates.push({
                        position: [lx, height - light.height / 128, lz, Math.max(0.5, light.radius / 128 * animation)],
                        color: [...light.color, light.strength / 16 * animation],
                        distance: (lx - playerX) ** 2 + (lz - playerZ) ** 2,
                    });
                }
            }
        }
    }
    // Match the source's nearest-light budget, bounded by the shader's uniform capacity.
    candidates.sort((a, b) => a.distance - b.distance);
    const count = Math.min(positions.length / 4, candidates.length);
    for (let i = 0; i < count; i++) {
        positions.set(candidates[i].position, i * 4);
        colors.set(candidates[i].color, i * 4);
    }
    return count;
}
