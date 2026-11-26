import { ACTOR_VERTEX_STRIDE } from "../buffer/ActorNormals";
import type { DynamicNpcFrameGeometry } from "./DynamicNpcAnimLoader";

export function usesNpcPriorityPass(npcTypeId: number): boolean {
    // The lizard and its opaque tray share one cache model and rely on painter order.
    return npcTypeId === 6011;
}

/** A face's render priority as SceneBuffer packs it into an actor vertex. */
function vertexPriority(vertices: DataView, vertex: number): number {
    return (vertices.getUint32(vertex * ACTOR_VERTEX_STRIDE + 8, true) >>> 6) & 7;
}

const mixedPriorities = new WeakMap<Int32Array, boolean>();

/**
 * Whether an actor mesh's faces span more than one render priority. The OSRS client paints such
 * a model's higher priorities over its lower ones whatever their depth: a translucent mesh like
 * this needs the painter pass, as depth alone keeps an outer shell in front of the layers inside.
 * `facePriorities` (one per triangle) gives the cache priorities; without it the vertex's banded
 * priority is read.
 */
export function hasMixedPriorities(vertices: Uint8Array, indices: Int32Array, facePriorities?: Uint8Array): boolean {
    let mixed = mixedPriorities.get(indices);
    if (mixed !== undefined) return mixed;
    mixed = false;
    if (indices.length > 0) {
        const view = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
        const priorityOf = (face: number) => facePriorities?.[face] ?? vertexPriority(view, indices[face * 3]);
        const first = priorityOf(0);
        for (let face = 1; face < indices.length / 3; face++) {
            if (priorityOf(face) !== first) {
                mixed = true;
                break;
            }
        }
    }
    mixedPriorities.set(indices, mixed);
    return mixed;
}

/** View-space Z direction in model space, after the actor shader's Y rotation. */
function viewDirection(viewMatrix: ArrayLike<number>, rotation: number): [number, number, number] {
    const angle = rotation * Math.PI / 1024;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    return [
        viewMatrix[2] * cos - viewMatrix[10] * sin,
        viewMatrix[6],
        viewMatrix[2] * sin + viewMatrix[10] * cos,
    ];
}

/**
 * The OSRS painter's order for one actor mesh: priority groups lowest first, each drawn from far
 * to near. Translation is constant across faces, so only the camera's direction matters.
 */
export function sortPainterIndices(
    vertices: Uint8Array,
    indices: Int32Array,
    viewMatrix: ArrayLike<number>,
    rotation: number,
    facePriorities?: Uint8Array,
): Int32Array {
    const [viewX, viewY, viewZ] = viewDirection(viewMatrix, rotation);
    const view = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    const depths = new Float32Array(vertices.length / ACTOR_VERTEX_STRIDE);
    const priorities = new Uint8Array(depths.length);
    for (let i = 0; i < depths.length; i++) {
        const offset = i * ACTOR_VERTEX_STRIDE;
        const x = view.getUint32(offset, true);
        const y = view.getUint32(offset + 4, true);
        const z = view.getUint32(offset + 8, true);
        const fraction = view.getUint32(offset + 16, true);
        depths[i] =
            viewX * ((x >>> 17) + (fraction & 1023) / 1024) -
            viewY * ((y & 32767) + ((fraction >>> 10) & 1023) / 1024) +
            viewZ * ((z >>> 17) + ((fraction >>> 20) & 1023) / 1024);
        priorities[i] = (z >>> 6) & 7;
    }

    // Draw each priority group from far to near.
    const faces = Array.from({ length: indices.length / 3 }, (_, face) => {
        const offset = face * 3;
        return {
            offset,
            priority: facePriorities?.[face] ?? priorities[indices[offset]],
            depth: depths[indices[offset]] + depths[indices[offset + 1]] + depths[indices[offset + 2]],
        };
    });
    faces.sort((a, b) => a.priority - b.priority || a.depth - b.depth);
    const sorted = new Int32Array(indices.length);
    for (let i = 0; i < faces.length; i++) {
        const { offset } = faces[i];
        sorted[i * 3] = indices[offset];
        sorted[i * 3 + 1] = indices[offset + 1];
        sorted[i * 3 + 2] = indices[offset + 2];
    }
    return sorted;
}

const sortedIndices = new WeakMap<Int32Array, { key: string; indices: Int32Array }>();

/**
 * A mesh's painter order for this camera, cached until the camera or the actor turns. `key`
 * names the result for the GPU geometry cache.
 */
export function getPainterIndices(
    baseKey: string,
    vertices: Uint8Array,
    indices: Int32Array,
    viewMatrix: ArrayLike<number>,
    rotation: number,
    facePriorities?: Uint8Array,
): { key: string; indices: Int32Array } {
    const [viewX, viewY, viewZ] = viewDirection(viewMatrix, rotation);
    const key = `${baseKey}|priority:${viewX},${viewY},${viewZ}`;
    const cached = sortedIndices.get(indices);
    if (cached?.key === key) return cached;
    const result = { key, indices: sortPainterIndices(vertices, indices, viewMatrix, rotation, facePriorities) };
    sortedIndices.set(indices, result);
    return result;
}

const sortedGeometry = new WeakMap<DynamicNpcFrameGeometry, DynamicNpcFrameGeometry>();

export function getNpcPriorityGeometry(
    geometry: DynamicNpcFrameGeometry,
    viewMatrix: ArrayLike<number>,
    rotation: number,
): DynamicNpcFrameGeometry {
    const sorted = getPainterIndices(geometry.key, geometry.opaqueVertices, geometry.opaqueIndices, viewMatrix, rotation);
    const cached = sortedGeometry.get(geometry);
    if (cached?.key === sorted.key) return cached;
    const result = { ...geometry, key: sorted.key, opaqueIndices: sorted.indices };
    sortedGeometry.set(geometry, result);
    return result;
}
