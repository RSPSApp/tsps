import assert from "node:assert/strict";
import { test } from "node:test";
import { mat4 } from "gl-matrix";

import { Camera, ProjectionType } from "../game/Camera";
import { HD_SSAO_WGSL } from "../game/plugins/hd/webgpu/hd-ssao.wgsl";

// The SSAO pass tells an orthographic camera from a perspective one by the inverse projection's
// column 2, row 3 (element 11): zero only when the projection has no perspective divide.
function inverseProjection(type: ProjectionType, orthoZoom = 15): Float32Array {
    const camera = new Camera(0, -10, 0, 256, 512);
    camera.setProjectionType(type);
    camera.orthoZoom = orthoZoom;
    // A scene viewport offset inside the screen, as the resizable layouts use.
    camera.update(1280, 800, 12, 30, 900, 600);
    return mat4.invert(new Float32Array(16), camera.projectionMatrix) as Float32Array;
}

test("SSAO's orthographic test holds for the client camera's projections", () => {
    const perspective = inverseProjection(ProjectionType.PERSPECTIVE);
    assert.ok(Math.abs(perspective[11]) > 1, `perspective inverse [11] = ${perspective[11]} must be far from 0`);
    for (const zoom of [1, 15, 60]) {
        assert.equal(Math.abs(inverseProjection(ProjectionType.ORTHO, zoom)[11]), 0,
            `orthographic inverse [11] must be 0 at ortho zoom ${zoom}`);
    }
});

test("SSAO reads the orthographic test from that element and skips the depth divide", () => {
    assert.match(HD_SSAO_WGSL, /let ortho = abs\(u_ssao\.u_invProj\[2\]\[3\]\) < 1e-6;/);
    assert.match(HD_SSAO_WGSL, /select\(max\(-P\.z, 0\.1\), 1\.0, ortho\)/);
    assert.match(HD_SSAO_WGSL, /select\(-normalize\(P\), vec3<f32>\(0\.0, 0\.0, 1\.0\), ortho\)/);
});
