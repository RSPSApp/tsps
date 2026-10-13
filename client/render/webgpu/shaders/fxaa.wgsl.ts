/**
Basic FXAA implementation based on the code on geeks3d.com with the
modification that the texture2DLod stuff was removed since it's
unsupported by WebGL.

--

From:
https://github.com/mitsuhiko/webgl-meincraft

Copyright (c) 2011 by Armin Ronacher.

Some rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.

    * Redistributions in binary form must reproduce the above
      copyright notice, this list of conditions and the following
      disclaimer in the documentation and/or other materials provided
      with the distribution.

    * The names of the contributors may not be used to endorse or
      promote products derived from this software without specific
      prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
/** WGSL port of render/shaders/includes/fxaa/fxaa.glsl, after tone mapping and before UI. */
export const FXAA_WGSL = `
@group(0) @binding(0) var t_scene: texture_2d<f32>;
@group(0) @binding(1) var s_scene: sampler;

@vertex
fn vs_fullscreen(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
    let positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
    return vec4<f32>(positions[index], 0.0, 1.0);
}

fn sampleColor(uv: vec2<f32>) -> vec3<f32> {
    return textureSampleLevel(t_scene, s_scene, uv, 0.0).rgb;
}

@fragment
fn fs_fxaa(@builtin(position) pixel: vec4<f32>) -> @location(0) vec4<f32> {
    let texel = 1.0 / vec2<f32>(textureDimensions(t_scene, 0));
    let uv = pixel.xy * texel;
    let nw = sampleColor(uv + vec2<f32>(-1.0, -1.0) * texel);
    let ne = sampleColor(uv + vec2<f32>(1.0, -1.0) * texel);
    let sw = sampleColor(uv + vec2<f32>(-1.0, 1.0) * texel);
    let se = sampleColor(uv + vec2<f32>(1.0, 1.0) * texel);
    let center = sampleColor(uv);
    let luma = vec3<f32>(0.299, 0.587, 0.114);
    let lNW = dot(nw, luma);
    let lNE = dot(ne, luma);
    let lSW = dot(sw, luma);
    let lSE = dot(se, luma);
    let lM = dot(center, luma);
    let lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    let lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    if (lMax - lMin < max(0.0312, lMax * 0.125)) {
        return vec4<f32>(center, 1.0);
    }
    var direction = vec2<f32>(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    let reduce = max((lNW + lNE + lSW + lSE) * (0.25 / 8.0), 1.0 / 128.0);
    let inverse = 1.0 / (min(abs(direction.x), abs(direction.y)) + reduce);
    direction = clamp(direction * inverse, vec2<f32>(-4.0), vec2<f32>(4.0)) * texel;
    let a = 0.5 * (sampleColor(uv + direction * (1.0 / 3.0 - 0.5)) +
        sampleColor(uv + direction * (2.0 / 3.0 - 0.5)));
    let b = a * 0.5 + 0.25 * (sampleColor(uv + direction * -0.5) + sampleColor(uv + direction * 0.5));
    let lB = dot(b, luma);
    // Preserve texture contrast while softening the staircase along silhouettes.
    return vec4<f32>(mix(center, select(b, a, lB < lMin || lB > lMax), 0.5), 1.0);
}
`;
