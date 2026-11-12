import assert from "node:assert/strict";

import { withSkyboxState } from "../render/SkyboxState";

// Review #4036: the skybox left CULL_FACE off for the whole scene. Every flag it touches must
// come back as it was, whichever way it started.
const DEPTH_TEST = 1, CULL_FACE = 2, BLEND = 3, DEPTH_WRITEMASK = 4;
for (const start of [true, false]) {
    const enabled = new Map([[DEPTH_TEST, start], [CULL_FACE, start], [BLEND, !start]]);
    let depthWrite = start;
    const during: Record<string, unknown> = {};
    const app = {
        gl: {
            DEPTH_TEST, CULL_FACE, BLEND, DEPTH_WRITEMASK,
            isEnabled: (cap: number) => enabled.get(cap) === true,
            getParameter: (name: number) => (name === DEPTH_WRITEMASK ? depthWrite : undefined),
        },
        enable: (cap: number) => enabled.set(cap, true),
        disable: (cap: number) => enabled.set(cap, false),
        depthMask: (mask: boolean) => { depthWrite = mask; },
    } as any;
    withSkyboxState(app, () => {
        during.depthTest = enabled.get(DEPTH_TEST);
        during.cull = enabled.get(CULL_FACE);
        during.blend = enabled.get(BLEND);
        during.depthWrite = depthWrite;
    });
    assert.deepEqual(during, { depthTest: false, cull: false, blend: true, depthWrite: false }, "the sky draws behind everything");
    assert.equal(enabled.get(CULL_FACE), start, "culling restored");
    assert.equal(enabled.get(DEPTH_TEST), start, "depth test restored");
    assert.equal(enabled.get(BLEND), !start, "blend restored");
    assert.equal(depthWrite, start, "depth writes restored");
}
console.log("skybox state: ok");
