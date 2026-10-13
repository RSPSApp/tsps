/**
 * WGSL port of client/render/shaders/main.frag.glsl. It depends on the shared declarations in
 * main.vert.wgsl.ts (bindings, SceneUniforms/MapUniforms, Material/getMaterial, VertexOutput,
 * glslMod, ...); shaders/index.ts concatenates the two into a single module.
 *
 * `alpha` replaces the WebGL `#define DISCARD_ALPHA` program variant: when true the early
 * texture-alpha discard is emitted exactly as in main.frag.glsl, when false it is omitted.
 *
 * `ext` fills the scene-extension slots (../sceneExtension.ts); `depth` adds the extension's
 * depth WGSL (sceneDepthPosition and fs_depth).
 */
import type { WebGPUSceneShaders } from "../sceneExtension";

export function createMainFragmentWgsl(
    alpha: boolean,
    ext?: WebGPUSceneShaders,
    depth: boolean = false,
): string {
    const discardBlock = alpha
        ? `
    // #ifdef DISCARD_ALPHA: early discard before expensive operations
    if ((input.v_texId == 0u && alpha < 0.01) || (textureColor.a < input.v_alphaCutOff)) {
        discard;
    }
`
        : "";
    const slots = ext?.world;
    return `
// ── Water constants (main.frag.glsl) ─────────────────────────────────────────────────────────

const WATER_NORMAL_1: f32 = 0.0;
const WATER_NORMAL_2: f32 = 1.0;
const WATER_FLOW: f32 = 2.0;
const WATER_FOAM: f32 = 3.0;
const WATER_CAUSTICS: f32 = 4.0;

// Underwater depth reconstruction: 7-bit mask depth 127 = 1380 * 0.55 units.
const WATER_MAX_DEPTH: f32 = 759.0;

// 117HD overworld lighting: sun at 52 degrees altitude, 235 azimuth (y-down).
const WATER_LIGHT_DIR: vec3<f32> = vec3<f32>(-0.5044, -0.7880, -0.3531);
const WATER_AMBIENT_COLOR: vec3<f32> = vec3<f32>(0.5922, 0.7294, 1.0); // #97baff
const WATER_AMBIENT_STRENGTH: f32 = 1.0;
const WATER_DIR_LIGHT_COLOR: vec3<f32> = vec3<f32>(1.0);
// 117HD uses 4.0 in its linear-light pipeline; rescaled for this sRGB pipeline.
const WATER_DIR_LIGHT_STRENGTH: f32 = 1.0;
const WATER_SKY_LIGHT_STRENGTH: f32 = 0.5;
// 117HD water reflection gradient: #b9d6ff with HSV value scaled to
// 0.8 / 0.45 / 0.05 in linear space, then converted back to sRGB.
const WATER_COLOR_LIGHT: vec3<f32> = vec3<f32>(0.6562, 0.7598, 0.9063);
const WATER_COLOR_MID: vec3<f32> = vec3<f32>(0.5046, 0.5861, 0.7014);
const WATER_COLOR_DARK: vec3<f32> = vec3<f32>(0.1690, 0.2017, 0.2478);

// Water mask texel: rgb = lit underlay colour of the tile (seabed / beach),
// a = water bit (0x80) plus 7-bit underwater depth.
struct WaterMaskSample {
    water: f32,
    shore: f32,
    depth: f32,
    bedColor: vec3<f32>,
};

fn readWaterMaskTexel(texel: vec2<i32>, layer: i32, maskSize: vec2<i32>) -> vec4<f32> {
    let clampedTexel = clamp(texel, vec2<i32>(0), maskSize - vec2<i32>(1));
    return textureLoad(u_mapWaterMask, clampedTexel, layer, 0);
}

fn waterMaskWaterBit(texel: vec4<f32>) -> f32 {
    return step(0.5, texel.a);
}

fn waterMaskDepth(texel: vec4<f32>) -> f32 {
    return max(texel.a * 255.0 - 128.0, 0.0) / 127.0;
}

fn sampleWaterMask(worldUv: vec2<f32>, plane: f32) -> WaterMaskSample {
    // WGSL textureDimensions(texture_2d_array) is vec2<u32>; layers come from textureNumLayers.
    let maskSize = textureDimensions(u_mapWaterMask, 0);
    let layerCount = textureNumLayers(u_mapWaterMask);
    let layer = clamp(i32(floor(plane + 0.5)), 0, i32(layerCount) - 1);

    let maskPos = worldUv - mapU.u_mapPos * 64.0 + vec2<f32>(f32(mapU.u_sceneBorderSize));
    let texel = vec2<i32>(floor(maskPos));
    let tileFract = fract(maskPos);
    let maskSizeXy = vec2<i32>(i32(maskSize.x), i32(maskSize.y));

    let centerWater = waterMaskWaterBit(readWaterMaskTexel(texel, layer, maskSizeXy));

    let leftWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(-1, 0), layer, maskSizeXy));
    let rightWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(1, 0), layer, maskSizeXy));
    let downWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(0, -1), layer, maskSizeXy));
    let upWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(0, 1), layer, maskSizeXy));
    let downLeftWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(-1, -1), layer, maskSizeXy));
    let downRightWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(1, -1), layer, maskSizeXy));
    let upLeftWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(-1, 1), layer, maskSizeXy));
    let upRightWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(1, 1), layer, maskSizeXy));

    var shoreFromLand = 0.0;
    shoreFromLand = max(shoreFromLand, (1.0 - leftWater) * (1.0 - tileFract.x));
    shoreFromLand = max(shoreFromLand, (1.0 - rightWater) * tileFract.x);
    shoreFromLand = max(shoreFromLand, (1.0 - downWater) * (1.0 - tileFract.y));
    shoreFromLand = max(shoreFromLand, (1.0 - upWater) * tileFract.y);
    shoreFromLand = max(shoreFromLand, (1.0 - downLeftWater) * (1.0 - tileFract.x) * (1.0 - tileFract.y));
    shoreFromLand = max(shoreFromLand, (1.0 - downRightWater) * tileFract.x * (1.0 - tileFract.y));
    shoreFromLand = max(shoreFromLand, (1.0 - upLeftWater) * (1.0 - tileFract.x) * tileFract.y);
    shoreFromLand = max(shoreFromLand, (1.0 - upRightWater) * tileFract.x * tileFract.y);
    shoreFromLand *= step(0.5, centerWater);

    // Bilinear depth and bed colour between tile centres for a smooth
    // underwater falloff that blends into the beach colour at the shore.
    let depthPos = maskPos - 0.5;
    let depthBase = vec2<i32>(floor(depthPos));
    let depthFract = fract(depthPos);
    let mask00 = readWaterMaskTexel(depthBase, layer, maskSizeXy);
    let mask10 = readWaterMaskTexel(depthBase + vec2<i32>(1, 0), layer, maskSizeXy);
    let mask01 = readWaterMaskTexel(depthBase + vec2<i32>(0, 1), layer, maskSizeXy);
    let mask11 = readWaterMaskTexel(depthBase + vec2<i32>(1, 1), layer, maskSizeXy);
    let depth = mix(
        mix(waterMaskDepth(mask00), waterMaskDepth(mask10), depthFract.x),
        mix(waterMaskDepth(mask01), waterMaskDepth(mask11), depthFract.x),
        depthFract.y,
    );
    let bedColor = mix(
        mix(mask00.rgb, mask10.rgb, depthFract.x),
        mix(mask01.rgb, mask11.rgb, depthFract.x),
        depthFract.y,
    );

    return WaterMaskSample(centerWater, shoreFromLand, depth, bedColor);
}

fn waterWorldUvs(worldUv: vec2<f32>, scale: f32) -> vec2<f32> {
    return -worldUv / scale;
}

fn waterAnimationFrame(animationDuration: f32, time: f32) -> f32 {
    if (animationDuration == 0.0) {
        return 0.0;
    }
    return glslMod(time, animationDuration) / animationDuration;
}

fn waterSpecular(viewDir: vec3<f32>, reflectDir: vec3<f32>, gloss: f32, strength: f32) -> f32 {
    let vDotR = clamp(dot(viewDir, reflectDir), 1e-10, 1.0);
    return pow(vDotR, gloss) * strength;
}

fn sampleCausticsChannel(flow1: vec2<f32>, flow2: vec2<f32>, aberration: vec2<f32>) -> f32 {
    return min(
        textureSampleLevel(u_waterTextures, u_sampler, flow1 + aberration, i32(WATER_CAUSTICS), 0.0).r,
        textureSampleLevel(u_waterTextures, u_sampler, flow2 + aberration, i32(WATER_CAUSTICS), 0.0).r,
    );
}

fn sampleCaustics(flow1: vec2<f32>, flow2: vec2<f32>, aberration: f32) -> vec3<f32> {
    let r = sampleCausticsChannel(flow1, flow2, aberration * vec2<f32>(1.0, 1.0));
    let g = sampleCausticsChannel(flow1, flow2, aberration * vec2<f32>(1.0, -1.0));
    let b = sampleCausticsChannel(flow1, flow2, aberration * vec2<f32>(-1.0, -1.0));
    return vec3<f32>(r, g, b);
}

fn shadeWater(
    worldUv: vec2<f32>,
    vanillaUv: vec2<f32>,
    worldPos: vec3<f32>,
    material: Material,
    waterMask: WaterMaskSample,
    time: f32,
) -> vec3<f32> {
    let duration = material.waterDuration;

    var uv1 = waterWorldUvs(worldUv, 3.0).yx - waterAnimationFrame(28.0 * duration, time);
    var uv2 = waterWorldUvs(worldUv, 3.0) + waterAnimationFrame(24.0 * duration, time);
    var uv3 = vanillaUv;

    let flowMapUv = waterWorldUvs(worldUv, 15.0) + waterAnimationFrame(50.0 * duration, time);
    let flowMapStrength = 0.025;
    let uvFlow = textureSampleLevel(u_waterTextures, u_sampler, flowMapUv, i32(WATER_FLOW), 0.0).xy;
    uv1 += uvFlow * flowMapStrength;
    uv2 += uvFlow * flowMapStrength;
    uv3 += uvFlow * flowMapStrength;

    let normalLayer = select(WATER_NORMAL_1, WATER_NORMAL_2, material.waterUseNormalMap2);
    let t1 = textureSampleLevel(u_waterTextures, u_sampler, uv1, i32(normalLayer), 0.0).xyz;
    let t2 = textureSampleLevel(u_waterTextures, u_sampler, uv2, i32(normalLayer), 0.0).xyz;
    let foamMask = textureSampleLevel(u_waterTextures, u_sampler, uv3, i32(WATER_FOAM), 0.0).r;

    let n1 = -vec3<f32>(
        (t1.x * 2.0 - 1.0) * material.waterNormalStrength,
        t1.z,
        (t1.y * 2.0 - 1.0) * material.waterNormalStrength,
    );
    let n2 = -vec3<f32>(
        (t2.x * 2.0 - 1.0) * material.waterNormalStrength,
        t2.z,
        (t2.y * 2.0 - 1.0) * material.waterNormalStrength,
    );
    let normals = normalize(n1 + n2);

    // mat3(u_viewMatrix) is the upper-left 3x3 (columns 0..2 of the mat4).
    let viewRotation = mat3x3<f32>(
        scene.u_viewMatrix[0].xyz,
        scene.u_viewMatrix[1].xyz,
        scene.u_viewMatrix[2].xyz,
    );
    let cameraWorld = -(scene.u_viewMatrix[3].xyz * viewRotation);
    let viewDir = normalize(cameraWorld - worldPos);

    let lightDotNormals = dot(normals, WATER_LIGHT_DIR);
    let downDotNormals = -normals.y;
    let viewDotNormals = dot(viewDir, normals);

    let ambientLightOut = WATER_AMBIENT_COLOR * WATER_AMBIENT_STRENGTH;

    let dirLightColor = WATER_DIR_LIGHT_COLOR * WATER_DIR_LIGHT_STRENGTH;
    let lightOut = max(lightDotNormals, 0.0) * dirLightColor;

    let lightReflectDir = reflect(-WATER_LIGHT_DIR, normals);
    let lightSpecularOut = dirLightColor *
        waterSpecular(viewDir, lightReflectDir, material.waterSpecularGloss, material.waterSpecularStrength);

    let skyLightOut = max(downDotNormals, 0.0) * scene.u_skyColor.rgb * WATER_SKY_LIGHT_STRENGTH;

    // fresnel reflection
    let baseOpacity = 0.4;
    let fresnel = 1.0 - clamp(viewDotNormals, 0.0, 1.0);
    var finalFresnel = clamp(mix(baseOpacity, 1.0, fresnel * 1.2), 0.0, 1.0);
    var surfaceColor: vec3<f32>;
    if (finalFresnel < 0.5) {
        surfaceColor = mix(WATER_COLOR_DARK, WATER_COLOR_MID, finalFresnel * 2.0);
    } else {
        surfaceColor = mix(WATER_COLOR_MID, WATER_COLOR_LIGHT, (finalFresnel - 0.5) * 2.0);
    }
    let surfaceColorOut = surfaceColor * max(material.waterSpecularStrength, 0.2);

    let compositeLight = ambientLightOut + lightOut + lightSpecularOut + skyLightOut + surfaceColorOut;

    var baseColor = material.waterSurfaceColor * compositeLight;
    baseColor = mix(baseColor, surfaceColor, material.waterFresnelAmount);
    if (abs(material.waterFresnelAmount - 0.85) < 0.01) {
        baseColor *= 0.75;
    }

    let shoreLineMask = waterMask.shore;
    let maxFoamAmount = 0.8;
    var foamAmount = min(shoreLineMask, maxFoamAmount);
    let foamDistance = 0.7;
    let foamColor = material.waterFoamColor * foamMask * compositeLight;
    foamAmount = clamp(pow(max(1.0 - ((1.0 - foamAmount) / foamDistance), 0.0), 3.0), 0.0, 1.0) *
        material.waterHasFoam;
    foamAmount *= foamColor.r;
    baseColor = mix(baseColor, foamColor, foamAmount);
    let specularComposite = mix(lightSpecularOut, vec3<f32>(0.0), foamAmount);
    let flatFresnel = 1.0 - dot(viewDir, vec3<f32>(0.0, -1.0, 0.0));
    finalFresnel = max(finalFresnel, flatFresnel);
    baseColor += lightSpecularOut / 3.0;

    let alpha = max(
        material.waterBaseOpacity,
        max(foamAmount, max(finalFresnel, length(specularComposite / 3.0))),
    );

    // Synthesized underwater terrain standing in for real underwater
    // geometry: the tile's underlay colour tinted by depth, with caustics,
    // composited under the surface by alpha and rendered opaque.
    let depth = waterMask.depth * WATER_MAX_DEPTH;
    var underwater = waterMask.bedColor;
    if (depth < 150.0) {
        underwater *= mix(vec3<f32>(1.0), material.waterDepthColor, depth / 150.0);
    } else if (depth < 500.0) {
        underwater *= mix(material.waterDepthColor, vec3<f32>(0.0), (depth - 150.0) / 350.0);
    } else {
        underwater = vec3<f32>(0.0);
    }

    let causticsUv = waterWorldUvs(worldUv, 1.75) * 0.75;
    let causticsDir = vec2<f32>(1.0, -2.0);
    let causticsFlow1 = causticsUv + waterAnimationFrame(17.0, time) * causticsDir;
    let causticsFlow2 = causticsUv * 1.5 - waterAnimationFrame(23.0, time) * causticsDir;
    let caustics = sampleCaustics(causticsFlow1, causticsFlow2, 0.005);
    var causticsDepthMultiplier = (depth - 512.0) / -512.0;
    causticsDepthMultiplier *= causticsDepthMultiplier;
    underwater *= 1.0 + caustics * WATER_DIR_LIGHT_STRENGTH * causticsDepthMultiplier *
        max(-WATER_LIGHT_DIR.y, 0.0) * WATER_DIR_LIGHT_STRENGTH;

    baseColor = mix(underwater, baseColor, alpha);

    // An extension's unclamped pipeline needs specular water highlights above 1 for HDR bloom.
    return ${ext
        ? "max(baseColor, vec3<f32>(0.0))"
        : "clamp(baseColor, vec3<f32>(0.0), vec3<f32>(1.0))"};
}

// brightness.glsl: the Settings "Screen brightness" on a lit surface (texel x vertex colour).
// u_brightness is OSRS's gamma exponent (lower is brighter); flat colours already carry it
// (hslToRgb), textures get the same change relative to the gamma the scene was tuned at.
const TUNED_BRIGHTNESS: f32 = 0.8;

fn applyBrightness(texel: vec3<f32>, lit: vec3<f32>) -> vec3<f32> {
    let regamma = pow(max(texel, vec3<f32>(1.0 / 255.0)), vec3<f32>(scene.u_brightness - TUNED_BRIGHTNESS));
    return texel * regamma * lit * TUNED_BRIGHTNESS;
}

fn sampleModelTexture(textureId: u32, texCoord: vec2<f32>) -> vec4<f32> {
    if (textureId == 0u) {
        return vec4<f32>(1.0);
    }
    return textureSampleLevel(u_textures, u_sampler, texCoord, i32(textureId), 0.0).bgra;
}

@fragment
fn fs_main(input: VertexOutput, @builtin(front_facing) front_facing: bool) -> @location(0) vec4<f32> {
    var textureColor = vec4<f32>(1.0);
${slots?.textureSample ?? "    textureColor = sampleModelTexture(input.v_texId, input.v_texCoord);"}
    var alpha = textureColor.a * input.v_color.a;
${discardBlock}
    // Only fetch material and do animation if texture is animated
    let material = getMaterial(input.v_texId);
    let frameCount = max(material.frameCount, 1);
    if (input.v_texId != 0u && frameCount > 1 && (${slots?.animateTexture ?? "true"})) {
        let frameSpeed = f32(max(material.animSpeed, 1));
        let frameT = glslMod(scene.u_currentTime * frameSpeed, f32(frameCount));
        let frame0 = floor(frameT);
        let frame1 = glslMod(frame0 + 1.0, f32(frameCount));
        let tMix = fract(frameT);
        let tex0 = textureSampleLevel(u_textures, u_sampler, input.v_texCoord, i32(f32(input.v_texId) + frame0), 0.0).bgra;
        let tex1 = textureSampleLevel(u_textures, u_sampler, input.v_texCoord, i32(f32(input.v_texId) + frame1), 0.0).bgra;
        textureColor = mix(tex0, tex1, tMix);
        alpha = textureColor.a * input.v_color.a;
    }

    let banding = max(scene.u_colorBanding, 1.0);
    var paletteColor = round(input.v_color.rgb * banding) / banding;
${slots?.palette ?? ""}
    var surface: vec3<f32>;
    // Water shading is floor-only; water textures on models (fountains,
    // waterfalls) keep the vanilla texture path like OSRS. It is 117 HD's
    // water, so it stays off unless a scene extension turns it on.
    let floorWater = ${slots?.floorWater ?? "false"};
    var isFloorWater = false;
    var waterMask = WaterMaskSample(0.0, 0.0, 0.0, vec3<f32>(0.0));
    if (floorWater && (material.flags & MATERIAL_FLAG_WATER) != 0) {
        waterMask = sampleWaterMask(input.v_worldUv, input.v_plane);
        isFloorWater = waterMask.water > 0.5;
    }
    if (isFloorWater) {
        surface = shadeWater(
            input.v_worldUv,
            input.v_texCoord,
            input.v_worldPos,
            material,
            waterMask,
            scene.u_currentTime,
        ) * scene.u_brightness;
    } else {
        surface = applyBrightness(textureColor.rgb, paletteColor);
    }

    var fog = clamp(input.v_fogAmount, 0.0, 1.0);
    fog = smoothstep(0.0, 1.0, fog);
    var fogColor = scene.u_skyColor.rgb;
${slots?.shade ?? ""}
    let finalRgb = mix(surface, fogColor, fog);

    // The extended (scene-extension) pipeline feeds an offscreen HDR target the extension
    // tonemaps, so it must not clip highlights; the base pipeline writes the canvas as before.
    return vec4<f32>(${ext
        ? "finalRgb"
        : "clamp(finalRgb, vec3<f32>(0.0), vec3<f32>(1.0))"}, alpha * mapU.u_worldEntityOpacity);
}
${depth && ext?.depth ? ext.depth(alpha) : ""}`;
}
