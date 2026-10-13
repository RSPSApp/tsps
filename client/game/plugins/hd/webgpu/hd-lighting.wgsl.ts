/**
 * WGSL port of ../hd-lighting.glsl (117HD non-water lighting) for the WebGPU scene extension.
 *
 * The HD resources extend the core's group(1) from SCENE_EXTENSION_FIRST_BINDING (6): HdUniforms,
 * the material lookup, the HD texture array and the depth32float shadow map. The shadow map has
 * no sampler (a depth texture cannot share group(1)'s filtering sampler), so hdShadow() takes its
 * 9 taps with textureLoad, matching the GLSL PCF and CLAMP_TO_EDGE reads.
 */

export const HD_BINDINGS_WGSL = `
struct HdUniforms {
    u_hdInverseView: mat4x4<f32>,
    u_hdShadowMatrix: mat4x4<f32>,
    u_hdLightDirection: vec4<f32>,
    u_hdAmbient: vec4<f32>,
    u_hdDirectional: vec4<f32>,
    u_hdFogColor: vec4<f32>,
    u_hdFog: vec4<f32>,          // start, end (tiles), curve exponent
    u_hdGroundFog: vec4<f32>,    // start, end, opacity
    u_hdGrading: vec4<f32>,      // saturation, contrast, brightness, rim
    u_hdSpecular: f32,
    u_hdShadowStrength: f32,
    u_hdLightCount: i32,
    u_hdEnabled: f32,
    u_hdLightPositions: array<vec4<f32>, 16>,
    u_hdLightColors: array<vec4<f32>, 16>,
    u_hdMist: vec4<f32>,         // mist level (tiles, y down), strength, wind x, wind z (HdMist.ts)
    u_hdQuality: vec4<f32>,      // x = mipmapped anisotropic filtering
};

@group(1) @binding(6) var<uniform> hd: HdUniforms;
@group(1) @binding(7) var u_hdMaterials: texture_2d<f32>;
@group(1) @binding(8) var u_hdTextures: texture_2d_array<f32>;
@group(1) @binding(9) var u_hdShadowMap: texture_depth_2d;
@group(1) @binding(10) var u_hdDetailTextures: texture_2d_array<f32>;
@group(1) @binding(11) var u_hdSampler: sampler;
`;

/**
 * Low-lying mist (as hdMistAmount in ../hd-lighting.glsl), reading its HdMist.ts uniform from
 * `mist`; shared by the scene and the grass so both sit in the same mist. Needs `scene`.
 * It pools below the area's mist level (y grows downwards) and thickens with how far the view
 * travels through it, so the ground nearby stays readable while a valley fills.
 */
export function hdMistWgsl(mist: string): string {
    return `
fn hdMistHash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn hdMistNoise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hdMistHash(i), hdMistHash(i + vec2<f32>(1.0, 0.0)), f.x),
        mix(hdMistHash(i + vec2<f32>(0.0, 1.0)), hdMistHash(i + vec2<f32>(1.0, 1.0)), f.x), f.y);
}

fn hdMistAmount(position: vec3<f32>) -> f32 {
    if (${mist}.y <= 0.0) {
        return 0.0;
    }
    let low = smoothstep(${mist}.x - 1.0, ${mist}.x + 2.0, position.y);
    let depth = 1.0 - exp(-length(position.xz - scene.u_cameraPos) * 0.07);
    let drift = position.xz * 0.07 + ${mist}.zw * scene.u_currentTime;
    let banks = hdMistNoise(drift) * 0.65 + hdMistNoise(drift * 2.3 + 17.0) * 0.35;
    // Clear around the player: none within 4 tiles, full by 14 (mirrored in hd-lighting.glsl).
    let clear = smoothstep(4.0, 14.0, length(position.xz - scene.u_playerPos));
    return clamp(low * depth * clear * mix(0.4, 1.0, banks) * ${mist}.y, 0.0, 1.0);
}
`;
}

export const HD_LIGHTING_WGSL = `
// Unlit HD materials (lava, fire, the infernal cape) are emissive: they bypass lighting and
// feed the HDR target above 1 so bloom catches them.
const HD_EMISSIVE_GAIN: f32 = 2.2;

fn hdSampleTexture(layer: f32, uv: vec2<f32>, dx: vec2<f32>, dy: vec2<f32>) -> vec4<f32> {
    if (layer < 0.0) {
        return textureSampleGrad(u_hdDetailTextures, u_hdSampler, uv, i32(-layer), dx, dy);
    }
    if (hd.u_hdQuality.x > 0.5) {
        return textureSampleGrad(u_hdTextures, u_hdSampler, uv, i32(layer), dx, dy);
    }
    return textureSampleLevel(u_hdTextures, u_sampler, uv, i32(layer), 0.0);
}


fn hdFogAmount(position: vec2<f32>) -> f32 {
    let delta = abs(position - scene.u_playerPos);
    let squareDist = max(delta.x, delta.y);
    return pow(smoothstep(hd.u_hdFog.x, hd.u_hdFog.y, squareDist), hd.u_hdFog.z);
}

${hdMistWgsl("hd.u_hdMist")}
fn hdShadow(position: vec3<f32>, normal: vec3<f32>) -> f32 {
    let projected = hd.u_hdShadowMatrix * vec4<f32>(position, 1.0);
    let p = projected.xyz / projected.w * 0.5 + 0.5;
    if (hd.u_hdShadowStrength == 0.0 || any(p < vec3<f32>(0.0)) || any(p > vec3<f32>(1.0))) {
        return 1.0;
    }
    let bias = max(0.0006 * (1.0 - max(dot(normal, hd.u_hdLightDirection.xyz), 0.0)), 0.00018);
    let size = vec2<i32>(textureDimensions(u_hdShadowMap, 0));
    // GL texture rows start at NDC y = -1, WebGPU's at y = +1: flip v or every shadow is
    // mirrored across the player-centred shadow map.
    let base = vec2<i32>(vec2<f32>(p.x, 1.0 - p.y) * vec2<f32>(size));
    var shadow = 0.0;
    for (var x = -1; x <= 1; x++) {
        for (var y = -1; y <= 1; y++) {
            // textureLoad takes integer texel coords; clamp to match the GLSL sampler's
            // CLAMP_TO_EDGE instead of the zero an out-of-bounds load returns.
            let coord = clamp(base + vec2<i32>(x, y), vec2<i32>(0), size - vec2<i32>(1));
            let depth = textureLoad(u_hdShadowMap, coord, 0);
            if (p.z - bias > depth) {
                shadow += 1.0;
            }
        }
    }
    let edge = min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y));
    return 1.0 - shadow / 9.0 * hd.u_hdShadowStrength * smoothstep(0.0, 0.05, edge);
}

fn hdMappedNormal(
    normal: vec3<f32>,
    uv: vec2<f32>,
    layer: f32,
    dx: vec3<f32>,
    dy: vec3<f32>,
    ux: vec2<f32>,
    uy: vec2<f32>,
) -> vec3<f32> {
    let determinant = ux.x * uy.y - ux.y * uy.x;
    if (abs(determinant) < 1e-8) {
        return normal;
    }
    var tangent = (dx * uy.y - dy * ux.y) / determinant;
    var bitangent = (dy * ux.x - dx * uy.x) / determinant;
    tangent -= normal * dot(normal, tangent);
    bitangent -= normal * dot(normal, bitangent);
    if (min(dot(tangent, tangent), dot(bitangent, bitangent)) < 1e-10) {
        return normal;
    }
    // 117 HD maps encode signed tangent X/Y, with an unsigned normal Z.
    var detail = hdSampleTexture(layer, uv, ux, uy).xyz;
    detail = vec3<f32>(detail.xy * 2.0 - 1.0, detail.z);
    return normalize(normalize(tangent) * detail.x + normalize(bitangent) * detail.y + normal * detail.z);
}

fn hdShade(
    surfaceIn: vec3<f32>,
    position: vec3<f32>,
    vNormal: vec3<f32>,
    material: vec4<f32>,
    metadata: vec4<f32>,
    uv: vec2<f32>,
    frontFacing: bool,
    dx: vec3<f32>, dy: vec3<f32>, ux: vec2<f32>, uy: vec2<f32>,
) -> vec3<f32> {
    // Bit 2 marks the source faces of lamps/torches, separate from their lit frames.
    if ((i32(metadata.y) & 4) != 0) {
        return pow(max(surfaceIn, vec3<f32>(0.0)), vec3<f32>(2.2)) * 6.0;
    }
    // metadata.y is a bitfield (HdMaterials.ts): bit 0 unlit, bit 1 worldUv.
    if ((i32(metadata.y) & 1) != 0) {
        // Linear HDR, no lighting. The gain only lifts near-white emissive cores (lava, the
        // infernal cape) into bloom range; mid-tone unlit surfaces (foliage, wood) keep the
        // WebGL brightness instead of washing out.
        let base = pow(max(surfaceIn, vec3<f32>(0.0)), vec3<f32>(2.2));
        let peak = max(base.r, max(base.g, base.b));
        return base * mix(1.0, HD_EMISSIVE_GAIN, smoothstep(0.6, 0.95, peak));
    }
    // Architecture/effects use face normals; actors and terrain interpolate
    // their own vertex normals to avoid visible triangle seams.
    var faceNormal = cross(dx, dy);
    faceNormal *= inverseSqrt(max(dot(faceNormal, faceNormal), 1e-12));
    let camera = -(scene.u_viewMatrix[3].xyz * mat3x3<f32>(
        scene.u_viewMatrix[0].xyz,
        scene.u_viewMatrix[1].xyz,
        scene.u_viewMatrix[2].xyz,
    ));
    let viewDir = normalize(camera - position);
    if (dot(faceNormal, viewDir) < 0.0) {
        faceNormal = -faceNormal;
    }
    var normal = faceNormal;
    if (dot(vNormal, vNormal) > 1e-8) {
        normal = normalize(vNormal);
        // A smooth normal may point past the camera at a visible silhouette.
        // Flipping there makes lighting jump; orient using triangle facing.
        if (!frontFacing) {
            normal = -normal;
        }
    }
    let offset = abs(position.xz - scene.u_playerPos);
    let detail = 1.0 - smoothstep(24.0, 48.0, max(offset.x, offset.y));
    var shadow = 1.0;
    if (detail > 0.0) {
        shadow = mix(1.0, hdShadow(position, faceNormal), detail);
        if (metadata.x != 0.0 && metadata.z > 0.0) {
            normal = normalize(mix(normal, hdMappedNormal(normal, uv, metadata.z, dx, dy, ux, uy), detail));
        }
    }
    let base = pow(max(surfaceIn, vec3<f32>(0.0)), vec3<f32>(2.2));
    let diffuse = max(dot(normal, hd.u_hdLightDirection.xyz), 0.0);
    if (detail <= 0.0) {
        return base * (hd.u_hdAmbient.xyz + hd.u_hdDirectional.xyz * diffuse);
    }
    var pointLight = vec3<f32>(0.0);
    for (var i = 0; i < 16; i++) {
        if (i >= hd.u_hdLightCount) {
            break;
        }
        let delta = hd.u_hdLightPositions[i].xyz - position;
        let radius = hd.u_hdLightPositions[i].w;
        let distanceSquared = dot(delta, delta);
        // Most fragments lie outside each local light's radius.
        if (distanceSquared >= radius * radius) {
            continue;
        }
        let distance = max(sqrt(distanceSquared), 0.001);
        let attenuation = max(1.0 - distance / radius, 0.0);
        pointLight += hd.u_hdLightColors[i].rgb * hd.u_hdLightColors[i].w * attenuation * attenuation * max(dot(normal, delta / distance), 0.0);
    }
    pointLight *= 1.1 * detail;
    let baseLuma = dot(base, vec3<f32>(0.2126, 0.7152, 0.0722));
    let additiveFloor = mix(0.035, 0.085, smoothstep(0.10, 0.45, baseLuma));
    var color = base * (hd.u_hdAmbient.xyz + hd.u_hdDirectional.xyz * diffuse * shadow + pointLight) + pointLight * additiveFloor;
    // Upstream gloss (material.y) is a Blinn-Phong specular exponent; map it to a
    // Cook-Torrance GGX roughness with the standard conversion
    // roughness = sqrt(2 / (exponent + 2)), clamped away from a perfect mirror.
    if (material.x > 0.0 && diffuse > 0.0) {
        let roughness = clamp(sqrt(2.0 / (max(material.y, 1.0) + 2.0)), 0.05, 1.0);
        let lightDir = hd.u_hdLightDirection.xyz;
        let half = normalize(lightDir + viewDir);
        let ndl = diffuse;
        let ndv = max(dot(normal, viewDir), 1e-4);
        let ndh = max(dot(normal, half), 0.0);
        // Trowbridge-Reitz (GGX) normal distribution.
        let a = roughness * roughness;
        let a2 = a * a;
        let d = a2 / (3.141592653589793 * pow(ndh * ndh * (a2 - 1.0) + 1.0, 2.0));
        // Smith-Schlick visibility term for direct lighting.
        let k = a * 0.5;
        let gv = ndv / (ndv * (1.0 - k) + k);
        let gl = ndl / (ndl * (1.0 - k) + k);
        // Schlick Fresnel with a dielectric F0.
        let f = vec3<f32>(0.04) + vec3<f32>(0.96) * pow(1.0 - max(dot(viewDir, half), 0.0), 5.0);
        let specular = d * gv * gl * f / max(4.0 * ndv * ndl, 1e-4);
        color += hd.u_hdDirectional.xyz * specular * ndl * material.x * hd.u_hdSpecular * shadow * detail;
    }
    color += vec3<f32>(pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0) * hd.u_hdGrading.w);
    // Linear HDR: saturation/contrast/exposure and the display encode moved to the HDR
    // tonemap pass (hd-tonemap), which replaces the old per-surface grade that clipped.
    return color;
}
`;
