import { ACTOR_VERTEX_STRIDE } from "../buffer/ActorNormals";
import type { DynamicNpcFrameGeometry } from "./DynamicNpcAnimLoader";

export function usesNpcPriorityPass(npcTypeId: number): boolean {
    // The lizard and its opaque tray share one cache model and rely on painter order.
    return npcTypeId === 6011;
}

const sortedGeometry = new WeakMap<DynamicNpcFrameGeometry, DynamicNpcFrameGeometry>();

export function getNpcPriorityGeometry(
    geometry: DynamicNpcFrameGeometry,
    viewMatrix: ArrayLike<number>,
    rotation: number,
): DynamicNpcFrameGeometry {
    const angle = rotation * Math.PI / 1024;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    // View-space Z after the NPC shader's Y rotation. Translation is constant across faces.
    const viewX = viewMatrix[2] * cos - viewMatrix[10] * sin;
    const viewY = viewMatrix[6];
    const viewZ = viewMatrix[2] * sin + viewMatrix[10] * cos;
    const key = `${geometry.key}|priority:${viewX},${viewY},${viewZ}`;
    const cached = sortedGeometry.get(geometry);
    if (cached?.key === key) return cached;

    const { opaqueVertices, opaqueIndices } = geometry;
    const vertices = new DataView(opaqueVertices.buffer, opaqueVertices.byteOffset, opaqueVertices.byteLength);
    const depths = new Float32Array(opaqueVertices.length / ACTOR_VERTEX_STRIDE);
    const priorities = new Uint8Array(depths.length);
    for (let i = 0; i < depths.length; i++) {
        const offset = i * ACTOR_VERTEX_STRIDE;
        const x = vertices.getUint32(offset, true);
        const y = vertices.getUint32(offset + 4, true);
        const z = vertices.getUint32(offset + 8, true);
        const fraction = vertices.getUint32(offset + 16, true);
        depths[i] =
            viewX * ((x >>> 17) + (fraction & 1023) / 1024) -
            viewY * ((y & 32767) + ((fraction >>> 10) & 1023) / 1024) +
            viewZ * ((z >>> 17) + ((fraction >>> 20) & 1023) / 1024);
        priorities[i] = (z >>> 6) & 7;
    }

    // The display uses priorities 0–3. Draw each group from far to near.
    const faces = Array.from({ length: opaqueIndices.length / 3 }, (_, face) => {
        const offset = face * 3;
        return {
            offset,
            priority: priorities[opaqueIndices[offset]],
            depth: depths[opaqueIndices[offset]] + depths[opaqueIndices[offset + 1]] +
                depths[opaqueIndices[offset + 2]],
        };
    });
    faces.sort((a, b) => a.priority - b.priority || a.depth - b.depth);
    const indices = new Int32Array(opaqueIndices.length);
    for (let i = 0; i < faces.length; i++) {
        const { offset } = faces[i];
        indices[i * 3] = opaqueIndices[offset];
        indices[i * 3 + 1] = opaqueIndices[offset + 1];
        indices[i * 3 + 2] = opaqueIndices[offset + 2];
    }

    const sorted = { ...geometry, key, opaqueIndices: indices };
    sortedGeometry.set(geometry, sorted);
    return sorted;
}
