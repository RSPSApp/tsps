import { HSL_RGB_MAP } from "../rs/util/ColorUtil";

export type SkyboxGeometry = { positions: Float32Array; colors: Float32Array; vertexCount: number };

function rgba(out: Float32Array, at: number, hsl: number, alpha: number): void {
    const rgb = HSL_RGB_MAP[hsl & 0xffff] ?? 0;
    out[at] = ((rgb >> 16) & 0xff) / 255;
    out[at + 1] = ((rgb >> 8) & 0xff) / 255;
    out[at + 2] = (rgb & 0xff) / 255;
    out[at + 3] = alpha;
}

/**
 * Triangles for a lit skybox model, in model units around the camera. A face's alpha byte is
 * its transparency (0 opaque); faces lighting hides (colour3 -2) are skipped, and flat faces
 * (colour3 -1) use colour1 at every corner, as the scene does.
 */
export function buildSkyboxGeometry(model: {
    faceCount: number;
    indices1: Int32Array; indices2: Int32Array; indices3: Int32Array;
    verticesX: ArrayLike<number>; verticesY: ArrayLike<number>; verticesZ: ArrayLike<number>;
    faceColors1: Int32Array; faceColors2: Int32Array; faceColors3: Int32Array;
    faceAlphas?: Int8Array;
}): SkyboxGeometry {
    const faces: number[] = [];
    for (let face = 0; face < model.faceCount; face++) {
        if (model.faceColors3[face] === -2) continue;
        if (model.faceAlphas && (model.faceAlphas[face] & 0xff) === 0xff) continue;
        faces.push(face);
    }
    const vertexCount = faces.length * 3;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 4);
    let v = 0;
    for (const face of faces) {
        const flat = model.faceColors3[face] === -1;
        const alpha = model.faceAlphas ? 1 - (model.faceAlphas[face] & 0xff) / 255 : 1;
        const corners = [model.indices1[face], model.indices2[face], model.indices3[face]];
        const shades = flat
            ? [model.faceColors1[face], model.faceColors1[face], model.faceColors1[face]]
            : [model.faceColors1[face], model.faceColors2[face], model.faceColors3[face]];
        for (let corner = 0; corner < 3; corner++, v++) {
            const index = corners[corner];
            positions[v * 3] = model.verticesX[index];
            positions[v * 3 + 1] = model.verticesY[index];
            positions[v * 3 + 2] = model.verticesZ[index];
            rgba(colors, v * 4, shades[corner], alpha);
        }
    }
    return { positions, colors, vertexCount };
}
