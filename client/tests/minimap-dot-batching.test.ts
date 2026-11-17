import assert from "node:assert/strict";

import { MinimapRenderer } from "../widgets/gl/MinimapRenderer";

const uploads: Float32Array[] = [];
const draws: { count: number; texture: unknown; vertices: Float32Array }[] = [];
let texture: unknown;
let vertices: Float32Array;
const gl: any = {
    TRIANGLES: 4, ARRAY_BUFFER: 34962,
    useProgram() {}, uniformMatrix4fv() {}, uniform2f() {}, uniform1f() {}, uniform1i() {},
    activeTexture() {}, bindVertexArray() {}, bindBuffer() {}, texParameteri() {},
    bindTexture(_target: number, value: unknown) { texture = value; },
    bufferData(_target: number, data: Float32Array) {
        vertices = data.slice();
        uploads.push(vertices);
    },
    drawElements(_mode: number, count: number) {
        draws.push({ count, texture, vertices });
    },
    drawArrays(_mode: number, start: number, count: number) {
        assert.equal(start, 0);
        assert.equal(vertices.length, count * 4);
        draws.push({ count, texture, vertices });
    },
};
const renderer: any = Object.assign(Object.create(MinimapRenderer.prototype), {
    gl, proj: new Float32Array(16), dotInstances: [], dotBuffer: new Float32Array(24),
    quadVerts: new Float32Array(16), mask: null,
    nearestTextures: new WeakSet(), preparedPrograms: new Set(),
});
const a = { tex: {} as WebGLTexture, w: 4, h: 6 };
const b = { tex: {} as WebGLTexture, w: 2, h: 2 };
renderer.begin(40, 50, 76, 0, 1);
renderer.queueDot(a, 0, 0);
renderer.queueDot(b, 10, 20, 2);
renderer.queueDot(a, 2, 4, 0.5);
renderer.flushDots();

assert.equal(draws.length, 2, "one draw per texture, preserving the existing texture-group order");
assert.equal(uploads.length, 2, "one vertex upload per texture");
assert.deepEqual(draws.map(d => [d.texture, d.count]), [[a.tex, 12], [b.tex, 6]]);
const quad = (x0: number, y0: number, x1: number, y1: number) => [
    x0, y0, 0, 0, x1, y0, 1, 0, x1, y1, 1, 1,
    x0, y0, 0, 0, x1, y1, 1, 1, x0, y1, 0, 1,
];
assert.deepEqual([...draws[0].vertices], [...quad(38, 47, 42, 53), ...quad(41, 52.5, 43, 55.5)]);
assert.deepEqual([...draws[1].vertices], quad(48, 68, 52, 72));
const capacity = renderer.dotBuffer;
renderer.flushDots();
assert.equal(draws.length, 2, "an empty queue draws nothing");
renderer.begin(10, 20, 76, 512, 2);
renderer.queueDot(a, 2, 3);
renderer.flushDots();
assert.equal(renderer.dotBuffer, capacity, "reuse staging storage between frames");
const rotated = quad(14, 13, 18, 19);
draws[2].vertices.forEach((value, i) => {
    assert.ok(Math.abs(value - rotated[i]) < 0.01, "rotation, zoom and sprite dimensions are preserved");
});

renderer.begin(0, 0, 76, 0, 1);
for (let i = 0; i < 17000; i++) renderer.queueDot(a, i, 0);
renderer.flushDots();
assert.equal(draws.length, 4, "large groups stay one draw without a 16-bit index limit");
assert.equal(draws[3].count, 17000 * 6);
assert.equal(renderer.dotInstances.length, 0);
console.log("minimap dot batching tests passed");

// GL state: a texture's sampling is set once, and a program's frame uniforms once per begin().
{
    const calls: string[] = [];
    const counting: any = new Proxy({ TRIANGLES: 4, ARRAY_BUFFER: 34962, TEXTURE_2D: 3553, TEXTURE0: 33984, TEXTURE1: 33985 }, {
        get: (target, name: string) => name in target ? target[name as keyof typeof target] : (..._args: unknown[]) => { calls.push(name); },
    });
    const r: any = Object.assign(Object.create(MinimapRenderer.prototype), {
        gl: counting, proj: new Float32Array(16), dotInstances: [], dotBuffer: new Float32Array(24),
        quadVerts: new Float32Array(16), mask: null,
        nearestTextures: new WeakSet(), preparedPrograms: new Set(),
        progMinimap: { name: "minimap" }, progOverlay: { name: "overlay" }, progSolid: { name: "solid" },
    });
    const tile = { tex: {} as WebGLTexture, w: 256, h: 256 };
    const icon = { tex: {} as WebGLTexture, w: 9, h: 9 };
    const maskTex = {} as WebGLTexture;
    const count = (name: string) => calls.filter((c) => c === name).length;
    const frame = () => {
        r.begin(100, 100, 76, 0, 1, { tex: maskTex, x: 0, y: 0, width: 152, height: 152 });
        for (let i = 0; i < 9; i++) r.drawTile(tile, i, i, 256);
        for (let i = 0; i < 5; i++) r.drawOverlay(icon, i, i);
        r.drawSolidRect(100, 100, 3, 3, [1, 1, 1, 1]);
    };
    frame();
    assert.equal(count("texParameteri"), 12, "tile, icon and mask textures each get their 4 sampler params once");
    assert.equal(count("drawElements"), 15, "every tile, icon and the marker still draws");
    assert.equal(count("useProgram"), 15, "the program is still made current for every draw");
    assert.equal(count("uniformMatrix4fv"), 3, "each program's projection is set once per frame");
    assert.equal(count("uniform4f"), 3, "and its mask bounds");
    calls.length = 0;
    frame();
    assert.equal(count("texParameteri"), 0, "known textures keep their sampling");
    assert.equal(count("uniformMatrix4fv"), 3, "the next begin() sets the frame uniforms again");
    assert.equal(count("bindTexture"), 14 * 2 + 1, "each textured draw binds its texture and the mask; the marker the mask");
    console.log("minimap GL state test passed");
}
