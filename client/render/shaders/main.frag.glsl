#version 300 es

precision highp float;

layout(std140, column_major) uniform;

#include "./includes/scene-uniforms.glsl";

uniform highp sampler2DArray u_textures;
uniform highp isampler2D u_textureMaterials;
uniform highp sampler2DArray u_waterTextures;
uniform highp sampler2DArray u_waterMask;
uniform vec2 u_mapPos;
uniform highp int u_sceneBorderSize;
uniform float u_worldEntityOpacity;

#include "./includes/material.glsl";

in vec4 v_color;
in vec2 v_texCoord;
in vec2 v_worldUv;
in vec3 v_worldPos;
flat in uint v_texId;
flat in float v_alphaCutOff;
in float v_fogAmount;
flat in float v_plane;

layout(location = 0) out vec4 fragColor;

const float WATER_NORMAL_1 = 0.0;
const float WATER_NORMAL_2 = 1.0;
const float WATER_FLOW = 2.0;
const float WATER_FOAM = 3.0;
const float WATER_CAUSTICS = 4.0;

// Underwater depth reconstruction: 7-bit mask depth 127 = 1380 * 0.55 units.
const float WATER_MAX_DEPTH = 759.0;

// Water mask texel: rgb = lit underlay colour of the tile (seabed / beach),
// a = water bit (0x80) plus 7-bit underwater depth.
struct WaterMaskSample {
    float water;
    float shore;
    float depth;
    vec3 bedColor;
};

// 117HD overworld lighting: sun at 52 degrees altitude, 235 azimuth (y-down).
const vec3 WATER_LIGHT_DIR = vec3(-0.5044, -0.7880, -0.3531);
const vec3 WATER_AMBIENT_COLOR = vec3(0.5922, 0.7294, 1.0); // #97baff
const float WATER_AMBIENT_STRENGTH = 1.0;
const vec3 WATER_DIR_LIGHT_COLOR = vec3(1.0);
// 117HD uses 4.0 in its linear-light pipeline; rescaled for this sRGB pipeline.
const float WATER_DIR_LIGHT_STRENGTH = 1.0;
const float WATER_SKY_LIGHT_STRENGTH = 0.5;
// 117HD water reflection gradient: #b9d6ff with HSV value scaled to
// 0.8 / 0.45 / 0.05 in linear space, then converted back to sRGB.
const vec3 WATER_COLOR_LIGHT = vec3(0.6562, 0.7598, 0.9063);
const vec3 WATER_COLOR_MID = vec3(0.5046, 0.5861, 0.7014);
const vec3 WATER_COLOR_DARK = vec3(0.1690, 0.2017, 0.2478);

vec4 readWaterMaskTexel(ivec2 texel, int layer, ivec3 maskSize) {
    ivec2 clampedTexel = clamp(texel, ivec2(0), maskSize.xy - ivec2(1));
    return texelFetch(u_waterMask, ivec3(clampedTexel, layer), 0);
}

float waterMaskWaterBit(vec4 texel) {
    return step(0.5, texel.a);
}

float waterMaskDepth(vec4 texel) {
    return max(texel.a * 255.0 - 128.0, 0.0) / 127.0;
}

WaterMaskSample sampleWaterMask(vec2 worldUv, float plane) {
    ivec3 maskSize = textureSize(u_waterMask, 0);
    int layer = clamp(int(floor(plane + 0.5)), 0, maskSize.z - 1);

    vec2 maskPos = worldUv - u_mapPos * 64.0 + vec2(float(u_sceneBorderSize));
    ivec2 texel = ivec2(floor(maskPos));
    vec2 tileFract = fract(maskPos);

    float centerWater = waterMaskWaterBit(readWaterMaskTexel(texel, layer, maskSize));

    float leftWater = waterMaskWaterBit(readWaterMaskTexel(texel + ivec2(-1, 0), layer, maskSize));
    float rightWater = waterMaskWaterBit(readWaterMaskTexel(texel + ivec2(1, 0), layer, maskSize));
    float downWater = waterMaskWaterBit(readWaterMaskTexel(texel + ivec2(0, -1), layer, maskSize));
    float upWater = waterMaskWaterBit(readWaterMaskTexel(texel + ivec2(0, 1), layer, maskSize));
    float downLeftWater = waterMaskWaterBit(readWaterMaskTexel(texel + ivec2(-1, -1), layer, maskSize));
    float downRightWater = waterMaskWaterBit(readWaterMaskTexel(texel + ivec2(1, -1), layer, maskSize));
    float upLeftWater = waterMaskWaterBit(readWaterMaskTexel(texel + ivec2(-1, 1), layer, maskSize));
    float upRightWater = waterMaskWaterBit(readWaterMaskTexel(texel + ivec2(1, 1), layer, maskSize));

    float shoreFromLand = 0.0;
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
    vec2 depthPos = maskPos - 0.5;
    ivec2 depthBase = ivec2(floor(depthPos));
    vec2 depthFract = fract(depthPos);
    vec4 mask00 = readWaterMaskTexel(depthBase, layer, maskSize);
    vec4 mask10 = readWaterMaskTexel(depthBase + ivec2(1, 0), layer, maskSize);
    vec4 mask01 = readWaterMaskTexel(depthBase + ivec2(0, 1), layer, maskSize);
    vec4 mask11 = readWaterMaskTexel(depthBase + ivec2(1, 1), layer, maskSize);
    float depth = mix(
        mix(waterMaskDepth(mask00), waterMaskDepth(mask10), depthFract.x),
        mix(waterMaskDepth(mask01), waterMaskDepth(mask11), depthFract.x),
        depthFract.y
    );
    vec3 bedColor = mix(
        mix(mask00.rgb, mask10.rgb, depthFract.x),
        mix(mask01.rgb, mask11.rgb, depthFract.x),
        depthFract.y
    );

    return WaterMaskSample(centerWater, shoreFromLand, depth, bedColor);
}

vec2 waterWorldUvs(vec2 worldUv, float scale) {
    return -worldUv / scale;
}

float waterAnimationFrame(float animationDuration, float time) {
    if (animationDuration == 0.0) {
        return 0.0;
    }
    return mod(time, animationDuration) / animationDuration;
}

float waterSpecular(vec3 viewDir, vec3 reflectDir, float gloss, float strength) {
    float vDotR = clamp(dot(viewDir, reflectDir), 1e-10, 1.0);
    return pow(vDotR, gloss) * strength;
}

float sampleCausticsChannel(vec2 flow1, vec2 flow2, vec2 aberration) {
    return min(
        texture(u_waterTextures, vec3(flow1 + aberration, WATER_CAUSTICS)).r,
        texture(u_waterTextures, vec3(flow2 + aberration, WATER_CAUSTICS)).r
    );
}

vec3 sampleCaustics(vec2 flow1, vec2 flow2, float aberration) {
    float r = sampleCausticsChannel(flow1, flow2, aberration * vec2(1.0, 1.0));
    float g = sampleCausticsChannel(flow1, flow2, aberration * vec2(1.0, -1.0));
    float b = sampleCausticsChannel(flow1, flow2, aberration * vec2(-1.0, -1.0));
    return vec3(r, g, b);
}

vec3 shadeWater(vec2 worldUv, vec2 vanillaUv, vec3 worldPos, Material mat, WaterMaskSample waterMask, float time) {
    float duration = mat.waterDuration;

    vec2 uv1 = waterWorldUvs(worldUv, 3.0).yx - waterAnimationFrame(28.0 * duration, time);
    vec2 uv2 = waterWorldUvs(worldUv, 3.0) + waterAnimationFrame(24.0 * duration, time);
    vec2 uv3 = vanillaUv;

    vec2 flowMapUv = waterWorldUvs(worldUv, 15.0) + waterAnimationFrame(50.0 * duration, time);
    float flowMapStrength = 0.025;
    vec2 uvFlow = texture(u_waterTextures, vec3(flowMapUv, WATER_FLOW)).xy;
    uv1 += uvFlow * flowMapStrength;
    uv2 += uvFlow * flowMapStrength;
    uv3 += uvFlow * flowMapStrength;

    float normalLayer = mat.waterUseNormalMap2 ? WATER_NORMAL_2 : WATER_NORMAL_1;
    vec3 t1 = texture(u_waterTextures, vec3(uv1, normalLayer)).xyz;
    vec3 t2 = texture(u_waterTextures, vec3(uv2, normalLayer)).xyz;
    float foamMask = texture(u_waterTextures, vec3(uv3, WATER_FOAM)).r;

    vec3 n1 = -vec3(
        (t1.x * 2.0 - 1.0) * mat.waterNormalStrength,
        t1.z,
        (t1.y * 2.0 - 1.0) * mat.waterNormalStrength
    );
    vec3 n2 = -vec3(
        (t2.x * 2.0 - 1.0) * mat.waterNormalStrength,
        t2.z,
        (t2.y * 2.0 - 1.0) * mat.waterNormalStrength
    );
    vec3 normals = normalize(n1 + n2);

    vec3 cameraWorld = -(u_viewMatrix[3].xyz * mat3(u_viewMatrix));
    vec3 viewDir = normalize(cameraWorld - worldPos);

    float lightDotNormals = dot(normals, WATER_LIGHT_DIR);
    float downDotNormals = -normals.y;
    float viewDotNormals = dot(viewDir, normals);

    vec3 ambientLightOut = WATER_AMBIENT_COLOR * WATER_AMBIENT_STRENGTH;

    vec3 dirLightColor = WATER_DIR_LIGHT_COLOR * WATER_DIR_LIGHT_STRENGTH;
    vec3 lightOut = max(lightDotNormals, 0.0) * dirLightColor;

    vec3 lightReflectDir = reflect(-WATER_LIGHT_DIR, normals);
    vec3 lightSpecularOut = dirLightColor *
        waterSpecular(viewDir, lightReflectDir, mat.waterSpecularGloss, mat.waterSpecularStrength);

    vec3 skyLightOut = max(downDotNormals, 0.0) * u_skyColor.rgb * WATER_SKY_LIGHT_STRENGTH;

    // fresnel reflection
    float baseOpacity = 0.4;
    float fresnel = 1.0 - clamp(viewDotNormals, 0.0, 1.0);
    float finalFresnel = clamp(mix(baseOpacity, 1.0, fresnel * 1.2), 0.0, 1.0);
    vec3 surfaceColor;
    if (finalFresnel < 0.5) {
        surfaceColor = mix(WATER_COLOR_DARK, WATER_COLOR_MID, finalFresnel * 2.0);
    } else {
        surfaceColor = mix(WATER_COLOR_MID, WATER_COLOR_LIGHT, (finalFresnel - 0.5) * 2.0);
    }
    vec3 surfaceColorOut = surfaceColor * max(mat.waterSpecularStrength, 0.2);

    vec3 compositeLight = ambientLightOut + lightOut + lightSpecularOut + skyLightOut + surfaceColorOut;

    vec3 baseColor = mat.waterSurfaceColor * compositeLight;
    baseColor = mix(baseColor, surfaceColor, mat.waterFresnelAmount);
    if (abs(mat.waterFresnelAmount - 0.85) < 0.01) {
        baseColor *= 0.75;
    }

    float shoreLineMask = waterMask.shore;
    float maxFoamAmount = 0.8;
    float foamAmount = min(shoreLineMask, maxFoamAmount);
    float foamDistance = 0.7;
    vec3 foamColor = mat.waterFoamColor * foamMask * compositeLight;
    foamAmount = clamp(pow(max(1.0 - ((1.0 - foamAmount) / foamDistance), 0.0), 3.0), 0.0, 1.0) *
        mat.waterHasFoam;
    foamAmount *= foamColor.r;
    baseColor = mix(baseColor, foamColor, foamAmount);
    vec3 specularComposite = mix(lightSpecularOut, vec3(0.0), foamAmount);
    float flatFresnel = 1.0 - dot(viewDir, vec3(0.0, -1.0, 0.0));
    finalFresnel = max(finalFresnel, flatFresnel);
    baseColor += lightSpecularOut / 3.0;

    float alpha = max(
        mat.waterBaseOpacity,
        max(foamAmount, max(finalFresnel, length(specularComposite / 3.0)))
    );

    // Synthesized underwater terrain standing in for real underwater
    // geometry: the tile's underlay colour tinted by depth, with caustics,
    // composited under the surface by alpha and rendered opaque.
    float depth = waterMask.depth * WATER_MAX_DEPTH;
    vec3 underwater = waterMask.bedColor;
    if (depth < 150.0) {
        underwater *= mix(vec3(1.0), mat.waterDepthColor, depth / 150.0);
    } else if (depth < 500.0) {
        underwater *= mix(mat.waterDepthColor, vec3(0.0), (depth - 150.0) / 350.0);
    } else {
        underwater = vec3(0.0);
    }

    vec2 causticsUv = waterWorldUvs(worldUv, 1.75) * 0.75;
    vec2 causticsDir = vec2(1.0, -2.0);
    vec2 causticsFlow1 = causticsUv + waterAnimationFrame(17.0, time) * causticsDir;
    vec2 causticsFlow2 = causticsUv * 1.5 - waterAnimationFrame(23.0, time) * causticsDir;
    vec3 caustics = sampleCaustics(causticsFlow1, causticsFlow2, 0.005);
    float causticsDepthMultiplier = (depth - 512.0) / -512.0;
    causticsDepthMultiplier *= causticsDepthMultiplier;
    underwater *= 1.0 + caustics * WATER_DIR_LIGHT_STRENGTH * causticsDepthMultiplier *
        max(-WATER_LIGHT_DIR.y, 0.0) * WATER_DIR_LIGHT_STRENGTH;

    baseColor = mix(underwater, baseColor, alpha);

    return clamp(baseColor, 0.0, 1.0);
}

vec4 sampleModelTexture(uint textureId, vec2 texCoord) {
    if (textureId == 0u) {
        return vec4(1.0);
    }
    return texture(u_textures, vec3(texCoord, float(textureId)), -2.0).bgra;
}

void main() {
    vec4 textureColor = sampleModelTexture(v_texId, v_texCoord);
    float alpha = textureColor.a * v_color.a;

#ifdef DISCARD_ALPHA
    // Early discard before expensive operations
    if ((v_texId == 0u && alpha < 0.01) || (textureColor.a < v_alphaCutOff)) {
        discard;
    }
#endif

    // Only fetch material and do animation if texture is animated
    Material mat = getMaterial(v_texId);
    int frameCount = max(mat.frameCount, 1);
    if (v_texId != 0u && frameCount > 1) {
        float frameSpeed = float(max(mat.animSpeed, 1));
        float frameT = mod(u_currentTime * frameSpeed, float(frameCount));
        float frame0 = floor(frameT);
        float frame1 = mod(frame0 + 1.0, float(frameCount));
        float tMix = fract(frameT);
        vec4 tex0 = texture(u_textures, vec3(v_texCoord, float(v_texId) + frame0), -2.0).bgra;
        vec4 tex1 = texture(u_textures, vec3(v_texCoord, float(v_texId) + frame1), -2.0).bgra;
        textureColor = mix(tex0, tex1, tMix);
        alpha = textureColor.a * v_color.a;
    }

    float banding = max(u_colorBanding, 1.0);
    vec3 paletteColor = round(v_color.rgb * banding) / banding;
    vec3 surface;
    // Water shading is floor-only; water textures on models (fountains,
    // waterfalls) keep the vanilla texture path like OSRS. It is 117 HD's
    // water, so it stays off unless the 117 HD plugin rewrites this flag.
    const bool hdWater = false;
    bool isFloorWater = false;
    WaterMaskSample waterMask = WaterMaskSample(0.0, 0.0, 0.0, vec3(0.0));
    if (hdWater && (mat.flags & MATERIAL_FLAG_WATER) != 0) {
        waterMask = sampleWaterMask(v_worldUv, v_plane);
        isFloorWater = waterMask.water > 0.5;
    }
    if (isFloorWater) {
        surface =
            shadeWater(v_worldUv, v_texCoord, v_worldPos, mat, waterMask, u_currentTime) * u_brightness;
    } else {
        surface = textureColor.rgb * paletteColor * u_brightness;
    }

    float fog = clamp(v_fogAmount, 0.0, 1.0);
    fog = smoothstep(0.0, 1.0, fog);

    vec3 finalRgb = mix(surface, u_skyColor.rgb, fog);

    fragColor = vec4(clamp(finalRgb, 0.0, 1.0), alpha * u_worldEntityOpacity);
}
