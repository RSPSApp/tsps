/**
 * WGSL for hd-ssao.ts: one fullscreen-triangle vertex plus the half-res SSAO and AO-blur
 * fragments of the 117 HD WebGPU HDR post chain.
 *
 * fs_ssao reconstructs view positions from the scene depth32float texture (non-reverse [0,1]
 * NDC z, gl-matrix view space: camera at the origin looking down -Z, 1 unit = 1 tile) with the
 * inverse projection, then takes 12 golden-angle samples on a per-pixel interleaved-gradient
 * noise rotation; fs_blur filters and upsamples with depth weights. ssaoUv converts a top-left framebuffer pixel
 * to the y-up convention the projection expects (NDC y=+1 is the framebuffer's top row), which
 * is a y flip relative to the pixel coordinates; sampling itself uses textureLoad on pixels.
 */

export const HD_SSAO_WGSL = `
struct SsaoUniforms {
    u_invProj: mat4x4<f32>, // inverse of the camera projection matrix (GL-style clip)
    u_params: vec4<f32>,    // x=radius (view units), y=maxRadius (view units), z=strength, w=bias
    u_screen: vec4<f32>,    // AO width, height, 1/width, 1/height (half the scene size)
    u_focal: vec4<f32>,     // x=projection y scale, y=depth-aware filter enabled
    u_scene: vec4<f32>,     // scene width, height, 1/width, 1/height (the depth texture size)
};

@group(0) @binding(0) var<uniform> u_ssao: SsaoUniforms;
@group(1) @binding(0) var u_depth: texture_depth_2d;
@group(1) @binding(1) var u_ao: texture_2d<f32>;

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}

fn ssaoUv(pixel: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(pixel.x * u_ssao.u_scene.z, 1.0 - pixel.y * u_ssao.u_scene.w);
}

fn ssaoViewPosition(uv: vec2<f32>, depth: f32) -> vec3<f32> {
    let ndc = vec4<f32>(uv * 2.0 - vec2<f32>(1.0, 1.0), depth * 2.0 - 1.0, 1.0);
    let v = u_ssao.u_invProj * ndc;
    return v.xyz / v.w;
}

@fragment
fn fs_ssao(@builtin(position) pixel: vec4<f32>) -> @location(0) vec4<f32> {
    // The AO target is half the scene size, but the depth texture is full size: work in depth
    // (scene) pixels throughout so samples land on the right texels.
    let scale = vec2<f32>(u_ssao.u_scene.x / u_ssao.u_screen.x, u_ssao.u_scene.y / u_ssao.u_screen.y);
    let pixelScene = pixel.xy * scale;
    let depth = textureLoad(u_depth, vec2<i32>(floor(pixelScene)), 0);
    // Derivatives must be evaluated in uniform control flow, before the sky early-out.
    let P = ssaoViewPosition(ssaoUv(pixelScene), depth);
    let dPdx = dpdx(P);
    let dPdy = dpdy(P);
    if (depth >= 0.9999) {
        return vec4<f32>(1.0);
    }
    var normal = normalize(cross(dPdx, dPdy));
    if (dot(normal, -normalize(P)) < 0.0) {
        normal = -normal;
    }

    let radiusPx = clamp(
        u_ssao.u_focal.x * u_ssao.u_params.x / max(-P.z, 0.1) * 0.5 * u_ssao.u_scene.y,
        1.0,
        128.0,
    );
    let noise = fract(52.9829189 * fract(0.06711056 * pixel.x + 0.00583715 * pixel.y));
    let angle = noise * 6.2831853;
    let maxRadius = u_ssao.u_params.y;
    let bias = u_ssao.u_params.w;
    var occlusion = 0.0;
    for (var i = 0; i < 12; i++) {
        let a = angle + f32(i) * 2.3999632;
        let r = (f32(i) + 0.5) / 12.0;
        let offs = vec2<f32>(cos(a), sin(a)) * radiusPx * r;
        let samplePixel = clamp(
            pixelScene + offs,
            vec2<f32>(0.0),
            u_ssao.u_scene.xy - vec2<f32>(1.0),
        );
        var depthQ = textureLoad(u_depth, vec2<i32>(floor(samplePixel)), 0);
        if (depthQ >= 0.9999) {
            continue;
        }
        let Q = ssaoViewPosition(ssaoUv(samplePixel), depthQ);
        let diff = Q - P;
        let dist = length(diff);
        if (dist > maxRadius) {
            continue;
        }
        occlusion += max(0.0, dot(diff / max(dist, 1e-5), normal) - bias) *
            saturate(1.0 - dist / maxRadius);
    }
    let ao = 1.0 - clamp(occlusion / 12.0 * u_ssao.u_params.z, 0.0, 1.0);
    return vec4<f32>(ao);
}

@fragment
fn fs_blur(@builtin(position) pixel: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<i32>(textureDimensions(u_ao, 0));
    let depthAware = u_ssao.u_focal.y > 0.5;
    let scale = u_ssao.u_scene.xy / u_ssao.u_screen.xy;
    let aoPixel = select(pixel.xy, pixel.xy / scale, depthAware);
    let base = vec2<i32>(floor(aoPixel));
    let centerPixel = select(pixel.xy * scale, pixel.xy, depthAware);
    let centerDepth = textureLoad(u_depth, vec2<i32>(floor(centerPixel)), 0);
    if (depthAware && centerDepth >= 0.9999) {
        return vec4<f32>(1.0);
    }
    let centerZ = ssaoViewPosition(ssaoUv(centerPixel), centerDepth).z;
    var color = 0.0;
    var weightSum = 0.0;
    for (var y = 0; y < 4; y++) {
        for (var x = 0; x < 4; x++) {
            let coord = clamp(base + vec2<i32>(x - 1, y - 1), vec2<i32>(0), size - vec2<i32>(1));
            var weight = 1.0;
            if (depthAware) {
                let tapPixel = (vec2<f32>(coord) + 0.5) * scale;
                let tapDepth = textureLoad(u_depth, vec2<i32>(floor(tapPixel)), 0);
                let tapZ = ssaoViewPosition(ssaoUv(tapPixel), tapDepth).z;
                let offset = vec2<f32>(coord) + 0.5 - aoPixel;
                // Reject other surfaces in view-space units, independent of camera distance.
                weight = exp(-abs(tapZ - centerZ) * 8.0 - dot(offset, offset) * 0.5);
                if (tapDepth >= 0.9999) { weight = 0.0; }
            }
            color += textureLoad(u_ao, coord, 0).r * weight;
            weightSum += weight;
        }
    }
    // Thin foreground objects may have no matching half-resolution depth sample.
    return vec4<f32>(select(1.0, color / max(weightSum, 1e-5), weightSum > 1e-5));
}
`;
