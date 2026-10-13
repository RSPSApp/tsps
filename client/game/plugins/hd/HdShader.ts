import type { ProgramSource } from "../../../render/shaders/ShaderUtil";

/** Adapt the shared world programs (never UI shaders); also gates the floor water shading. */
export function createHdProgram([vertex, fragment]: ProgramSource, lighting: string): ProgramSource {
    const vertexEnd = vertex.lastIndexOf("}");
    if (vertexEnd < 0 || !vertex.includes("vec4 viewPos =") || !fragment.includes("void main()") ||
        !fragment.includes("    float banding =") || !fragment.includes("    vec3 finalRgb = mix(surface, u_skyColor.rgb, fog);")) {
        throw new Error("117 HD: unsupported scene shader");
    }
    const terrain = vertex.includes("CONTOUR_GROUND_NONE");
    const actorInfo = vertex.includes("struct PlayerInfo") ? "playerInfo" : vertex.includes("struct NpcInfo") ? "npcInfo" : undefined;
    if (actorInfo) vertex = vertex.replace("in uvec3 a_vertex;", "in uvec4 a_vertex;");
    vertex = vertex.slice(0, vertexEnd) + `
    v_hdTerrain = ${terrain ? "modelInfo.contourGround == 3.0 ? 1.0 : 0.0" : "0.0"};
    v_hdGroundMaterial = ${terrain ? "v_hdTerrain > 0.5 && vertex.textureId == 0u ? uint(max(round(-vertex.texCoord.x * 64.0), 0.0)) : 0u" : "0u"};
    v_hdNormal = ${terrain ? "u_hdEnabled && !u_hdShadowPass && v_hdTerrain > 0.5 ? hdTerrainNormal(localPos.xz - u_mapPos * 64.0, modelInfo.plane) : vec3(0.0)" : actorInfo ? `u_hdEnabled && !u_hdShadowPass && (a_vertex.w >> 16u) != 0u ? mat3(u_hdInverseView * u_worldEntityTransform * u_viewMatrix) * (vec4(${actorInfo === "playerInfo" ? "skinNormal(hdActorNormal(a_vertex.w))" : "hdActorNormal(a_vertex.w)"}, 0.0) * rotationY(float(${actorInfo}.rotation) * RS_TO_RADIANS)).xyz : vec3(0.0)` : "vec3(0.0)"};
    ${actorInfo ? `if (u_hdEnabled && !u_hdShadowPass && (a_vertex.w >> 16u) != 0u) {
        int baseHsl = applyHslOverride(int(a_vertex.w & 0xffffu), ${actorInfo}.hslOverride);
        baseHsl = applyHslOverride(baseHsl, u_sceneHslOverride);
        v_color.rgb = vertex.textureId == 0u ? hslToRgb(baseHsl, u_brightness) : vec3(90.0 / 127.0);
    }` : ""}
    v_hdPosition = u_hdEnabled ? (u_hdInverseView * viewPos).xyz : vec3(0.0);
    if (u_hdShadowPass) gl_Position = u_hdShadowMatrix * vec4(v_hdPosition, 1.0);
` + vertex.slice(vertexEnd);
    vertex = vertex.replace("void main()", `
out vec3 v_hdPosition;
out vec3 v_hdNormal;
flat out uint v_hdGroundMaterial;
flat out float v_hdTerrain;
uniform bool u_hdEnabled;
uniform mat4 u_hdInverseView;
uniform bool u_hdShadowPass;
uniform mat4 u_hdShadowMatrix;
${actorInfo ? `
vec3 hdActorNormal(uint data) {
    vec2 xy = (vec2(float((data >> 16u) & 255u), float(data >> 24u)) - 128.0) / 127.0;
    vec3 n = vec3(xy, 1.0 - abs(xy.x) - abs(xy.y));
    if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * mix(vec2(-1.0), vec2(1.0), greaterThanEqual(n.xy, vec2(0.0)));
    return normalize(n);
}` : ""}
${terrain ? `
float hdHeight(ivec2 p, uint plane) {
    ivec2 size = textureSize(u_heightMap, 0).xy;
    p = clamp(p + u_sceneBorderSize, ivec2(0), size - 1);
    return float(texelFetch(u_heightMap, ivec3(p, int(plane)), 0).r) * 8.0;
}
vec3 hdCornerNormal(ivec2 p, uint plane) {
    return normalize(vec3(hdHeight(p - ivec2(1, 0), plane) - hdHeight(p + ivec2(1, 0), plane),
        -256.0, hdHeight(p - ivec2(0, 1), plane) - hdHeight(p + ivec2(0, 1), plane)));
}
vec3 hdTerrainNormal(vec2 position, uint plane) {
    ivec2 p = ivec2(floor(position));
    vec2 f = fract(position);
    // Most terrain vertices sit on corners: avoid fetching the other three
    // corner normals when their interpolation weights are zero.
    if (all(lessThan(f, vec2(0.00001)))) return hdCornerNormal(p, plane);
    return normalize(mix(mix(hdCornerNormal(p, plane), hdCornerNormal(p + ivec2(1, 0), plane), f.x),
        mix(hdCornerNormal(p + ivec2(0, 1), plane), hdCornerNormal(p + ivec2(1, 1), plane), f.x), f.y));
}` : ""}
void main()`);

    const water = fragment.includes("bool isFloorWater = false;");
    fragment = fragment.replace("void main()", lighting + "\nvoid main()");
    const mainStart = fragment.indexOf("void main()");
    const declarations = fragment.slice(0, mainStart);
    fragment = fragment.slice(mainStart);
    fragment = fragment.replace("void main() {", `void main() {
    // The shared vertex path leaves moving boat decks unfogged because they
    // use their own coordinates. Honour that exemption in the HD path too.
    float hdDistanceFog = u_hdEnabled && !u_hdShadowPass && v_fogAmount > 0.0 ? hdFogAmount(v_hdPosition.xz) : 0.0;
    // Fully obscured fragments contribute exactly the clear colour. Skip
    // texture/alpha/material work; nearer geometry still passes its depth test.
    if (hdDistanceFog >= 1.0) discard;
    // Opaque shadows only need depth. Cutout textures still take the alpha
    // path below, preserving holes in foliage, fences and equipment.
    if (u_hdShadowPass) {
#ifdef DISCARD_ALPHA
        if (v_texId == 0u) {
#endif
            if (v_color.a < 0.5) discard;
            fragColor = vec4(1.0);
            return;
#ifdef DISCARD_ALPHA
        }
#endif
    }
`);
    // The HD replacement already supplies albedo and alpha. Avoid sampling
    // the cache texture as well when a replacement image is ready.
    const cacheSample = water ? "sampleModelTexture(v_texId, v_texCoord)"
        : "texture(u_textures, vec3(v_texCoord, v_texId), -2.0).bgra";
    fragment = fragment.replace(`    vec4 textureColor = ${cacheSample};`, "    vec4 textureColor = vec4(1.0);");
    fragment = fragment.replace("    float alpha =", `
    int hdMaterialIndex = int(v_texId);
    if (v_texId == 0u && v_hdGroundMaterial > 0u) hdMaterialIndex = 1024 + int(v_hdGroundMaterial);
    vec4 hdMaterial = u_hdEnabled ? texelFetch(u_hdMaterials, ivec2(hdMaterialIndex, 0), 0) : vec4(0.0, 1.0, 1.0, 1.0);
    vec4 hdMetadata = u_hdEnabled ? texelFetch(u_hdMaterials, ivec2(hdMaterialIndex, 1), 0) : vec4(0.0, 0.0, 0.0, 1.0);
    ${terrain ? "if (u_hdEnabled && v_texId == 0u && v_hdTerrain < 0.5 && v_texCoord.y == -1.0) hdMetadata.y = 5.0;" : ""}
    float hdLayer = hdMetadata.x;
    vec2 scale = hdMaterial.zw;
    scale = mix(vec2(1.0), scale, greaterThan(abs(scale), vec2(0.001)));
    vec2 hdUv = v_hdGroundMaterial > 0u ? v_hdPosition.xz / scale : (v_texCoord - 0.5) / scale + 0.5;
    ${terrain ? `if (u_hdEnabled && v_hdGroundMaterial == 0u && (int(hdMetadata.y) & 2) != 0) {
        // Masonry courses stay level and continuous across cache model faces.
        vec3 face = abs(normalize(cross(dFdx(v_hdPosition), dFdy(v_hdPosition))));
        hdUv = face.y > 0.7 ? v_hdPosition.xz / scale
            : vec2(face.x > face.z ? v_hdPosition.z : v_hdPosition.x, -v_hdPosition.y) / scale;
    }` : ""}
    if (u_hdEnabled && v_hdGroundMaterial > 0u && v_hdGroundMaterial <= 5u) {
        // Smooth, world-stable variation breaks the one-tile repeat on organic
        // ground. It adds no texture samples and never randomises paved courses.
        hdUv += 0.3 * sin(vec2(dot(hdUv, vec2(0.37, 0.61)), dot(hdUv, vec2(-0.53, 0.29))));
    }
    if (hdLayer < 0.0) textureColor = texture(u_hdDetailTextures, vec3(hdUv, -hdLayer), hdDistanceFog * 2.0);
    else if (hdLayer > 0.0) textureColor = texture(u_hdTextures, vec3(hdUv, hdLayer), hdDistanceFog * 2.0);
    else textureColor = ${cacheSample};
    float alpha =`);
    fragment = fragment.replace("frameCount > 1)", "frameCount > 1 && hdLayer == 0.0)");
    fragment = fragment.replace("    float banding =", `
    if (u_hdShadowPass) {
        if (alpha < 0.5) discard;
        fragColor = vec4(1.0);
        return;
    }
    float banding =`);
    // Floor water is 117 HD's: core leaves it off, HD turns it on with the toggle.
    fragment = fragment.replace("const bool hdWater = false;", "bool hdWater = u_hdEnabled;");
    fragment = fragment.replace("    vec3 surface;", `
    // Like 117 HD, replace baked directional shading on textured faces with
    // neutral brightness. Otherwise brick walls are lit twice and lose detail.
    if (u_hdEnabled && hdLayer != 0.0 && v_texId != 0u) paletteColor = vec3(90.0 / 127.0);
    vec3 surface;`);
    fragment = fragment.replace("    vec3 finalRgb = mix(surface, u_skyColor.rgb, fog);", `
    vec3 fogColor = u_skyColor.rgb;
    if (u_hdEnabled && ${water ? "!isFloorWater" : "true"}) {
        surface = hdShade(surface * hdMetadata.w, v_hdPosition, hdMaterial, hdMetadata, hdUv);
        float groundFog = smoothstep(0.0, 1.0, (v_hdPosition.y - u_hdGroundFog.x) / min(-0.001, u_hdGroundFog.y - u_hdGroundFog.x)) * u_hdGroundFog.z;
        fog = max(fog, max(hdDistanceFog, groundFog));
        fogColor = mix(u_hdFogColor, u_skyColor.rgb, hdDistanceFog);
    }
    // Low-lying mist settles over everything in the hollow, floor water included.
    if (u_hdEnabled) surface = mix(surface, u_hdFogColor, hdMistAmount(v_hdPosition));
    vec3 finalRgb = mix(surface, fogColor, fog);`);
    return [vertex, declarations + fragment];
}
