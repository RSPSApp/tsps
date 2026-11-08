import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// Execute a scalar channel of the production vector helper, rather than repeating its math.
// Live backend runs separately compile these shaders and exercise actual slider uniforms.
function productionChannel(file: string): (texel: number, lit: number, brightness: number) => number {
    const source = fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
    const match = /(?:vec3|fn) applyBrightness\([^]*?\{([^]*?)\n\}/.exec(source);
    assert.ok(match, `production brightness helper exists in ${file}`);
    const body = match[1].replace(/vec3(?:<f32>)?\(/g, "(")
        .replace(/vec3 (\w+)\s*=/g, "const $1 =")
        .replace(/scene\.u_brightness|u_brightness/g, "brightness")
        .replace(/\bpow\(/g, "Math.pow(").replace(/\bmax\(/g, "Math.max(");
    const tuned = /TUNED_BRIGHTNESS(?:: f32)? = ([\d.]+)/.exec(source)?.[1] ?? "NaN";
    return new Function("texel", "lit", "brightness", `const TUNED_BRIGHTNESS = ${tuned}; ${body}`) as any;
}
// Native Rasterizer3D.adjustBrightness: floor(pow(byte/256, gamma)*256).
// The GPU stores normalized bytes/255, so at most one channel byte differs through quantization.
const nativeTextureBytes = [
    { gamma: 1.0, bytes: [0, 1, 32, 64, 128, 254, 255] },
    { gamma: 0.75, bytes: [0, 4, 53, 90, 152, 254, 255] },
    { gamma: 0.5, bytes: [0, 16, 90, 128, 181, 254, 255] },
];
for (const file of ["render/shaders/includes/brightness.glsl", "render/webgpu/shaders/main.frag.wgsl.ts", "render/webgpu/shaders/actor.wgsl.ts"]) {
    test(`native palette/texture brightness is applied exactly once: ${file}`, () => {
        const shade = productionChannel(file);
        for (const { gamma, bytes } of nativeTextureBytes) {
            for (const [index, value] of [0, 1, 32, 64, 128, 254, 255].entries()) {
                const actual = shade(value / 255, 1, gamma) * 255;
                assert.ok(Math.abs(actual - bytes[index]) <= 1, `${file}, gamma ${gamma}, byte ${value}: ${actual} vs native ${bytes[index]}`);
            }
            for (const alreadyCorrectedPalette of [0, 0.125, 0.5, 1]) {
                assert.equal(shade(1, alreadyCorrectedPalette, gamma), alreadyCorrectedPalette,
                    "untextured HSL palette is not dimmed or gamma-corrected twice");
            }
            assert.equal(shade(0.25, 0.5, gamma), shade(0.25, 1, gamma) * 0.5, "ordinary vertex lighting remains multiplicative");
            assert.equal(shade(0, 1, gamma), 0, "black stays black without NaN");
        }
    });
}
