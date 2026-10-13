import { mat4, vec3 } from "gl-matrix";

import type { WorldEntityAnimator } from "./WorldEntityAnimator";

const inverseView = mat4.create();
const point = vec3.create();

/** Converts a deck point to world space using the exact transform applied after V in the shaders. */
export function transformWorldEntityPoint(
    viewMatrix: Float32Array,
    animator: WorldEntityAnimator | undefined,
    entityIndex: number,
    x: number,
    y: number,
    z: number,
): [number, number, number] | null {
    const transform = animator?.getTransform(entityIndex);
    if (!transform || !mat4.invert(inverseView, viewMatrix)) return null;
    // Main and actor shaders project P * T * V * p. The ordinary projector expects
    // world coordinates, so provide V^-1 * T * V * p, retaining camera-space bobbing.
    vec3.set(point, x, y, z);
    vec3.transformMat4(point, point, viewMatrix);
    vec3.transformMat4(point, point, transform);
    vec3.transformMat4(point, point, inverseView);
    return [point[0], point[1], point[2]];
}
