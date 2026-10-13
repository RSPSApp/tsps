/**
 * 117 HD's WGSL for the WebGPU scene-extension slots (render/webgpu/sceneExtension.ts): the
 * WebGPU counterpart of ../HdShader.ts's GLSL injections. World varyings start at location 8,
 * actor varyings at 5.
 */
import type { WebGPUSceneShaders } from "../../../../render/webgpu/sceneExtension";
import { HD_BINDINGS_WGSL, HD_LIGHTING_WGSL } from "./hd-lighting.wgsl";

/** HdShader.ts's terrain normals: interpolated height-map corner normals. */
const TERRAIN_WGSL = `
fn hdHeight(p: vec2<i32>, plane: u32) -> f32 {
    let size = vec2<i32>(textureDimensions(u_mapHeightMap, 0));
    let clamped = clamp(p + vec2<i32>(mapU.u_sceneBorderSize), vec2<i32>(0), size - vec2<i32>(1));
    return f32(textureLoad(u_mapHeightMap, clamped, i32(plane), 0).r) * 8.0;
}

fn hdCornerNormal(p: vec2<i32>, plane: u32) -> vec3<f32> {
    return normalize(vec3<f32>(
        hdHeight(p - vec2<i32>(1, 0), plane) - hdHeight(p + vec2<i32>(1, 0), plane),
        -256.0,
        hdHeight(p - vec2<i32>(0, 1), plane) - hdHeight(p + vec2<i32>(0, 1), plane),
    ));
}

fn hdTerrainNormal(position: vec2<f32>, plane: u32) -> vec3<f32> {
    let p = vec2<i32>(floor(position));
    let f = fract(position);
    // Most terrain vertices sit on corners: avoid fetching the other three
    // corner normals when their interpolation weights are zero.
    if (all(f < vec2<f32>(0.00001))) {
        return hdCornerNormal(p, plane);
    }
    return normalize(mix(
        mix(hdCornerNormal(p, plane), hdCornerNormal(p + vec2<i32>(1, 0), plane), f.x),
        mix(hdCornerNormal(p + vec2<i32>(0, 1), plane), hdCornerNormal(p + vec2<i32>(1, 1), plane), f.x),
        f.y,
    ));
}
`;

/**
 * Actor normals and colours. NPC/player vertices carry, in their 4th word, the unshaded base
 * HSL (bits 0-15) and an octahedral normal (bits 16-31, ActorNormals.packActorNormal).
 */
const ACTOR_WGSL = `
fn hdActorNormal(data: u32) -> vec3<f32> {
    let xy = (vec2<f32>(f32((data >> 16u) & 0xFFu), f32(data >> 24u)) - 128.0) / 127.0;
    var n = vec3<f32>(xy.x, xy.y, 1.0 - abs(xy.x) - abs(xy.y));
    if (n.z < 0.0) {
        let oldX = n.x;
        let oldY = n.y;
        n.x = (1.0 - abs(oldY)) * select(-1.0, 1.0, oldX >= 0.0);
        n.y = (1.0 - abs(oldX)) * select(-1.0, 1.0, oldY >= 0.0);
    }
    return normalize(n);
}

// HdShader.ts: mat3(u_hdInverseView * u_viewMatrix) * (skinNormal(n) * rotationY(rot)).
fn hdActorWorldNormal(modelNormal: vec3<f32>, rotation: u32) -> vec3<f32> {
    let rotated = glslRowMul(
        vec4<f32>(modelNormal, 0.0),
        rotationY(f32(rotation) * RS_TO_RADIANS),
    ).xyz;
    let m = hd.u_hdInverseView * scene.u_viewMatrix;
    return mat3x3<f32>(m[0].xyz, m[1].xyz, m[2].xyz) * rotated;
}

// HdShader.ts's v_color override: only faces carrying a normal word recompute from the
// unshaded base HSL; textured faces use 117 HD's neutral brightness.
fn hdActorColor(vertex: Vertex, hslOverride: vec4<f32>, normalWord: u32) -> vec3<f32> {
    if (hd.u_hdEnabled <= 0.5 || (normalWord >> 16u) == 0u) {
        return vertex.color.rgb;
    }
    var baseHsl = applyHslOverride(i32(normalWord & 0xFFFFu), hslOverride);
    baseHsl = applyHslOverride(baseHsl, scene.u_sceneHslOverride);
    if (vertex.textureId != 0u) {
        return vec3<f32>(90.0 / 127.0);
    }
    return hslToRgb(baseHsl, scene.u_brightness);
}
`;

/**
 * HD material lookup + texture replacement; `groundUv` maps untextured terrain recipes.
 * The terrain variant also blends the neighbouring tile's HD ground texture into the albedo
 * near tile borders (117HD TerrainDataGenerator's overlay/underlay blending, done per-pixel
 * here): grass fades into dirt instead of swapping per tile. Water keeps its own path.
 */
function materialSetup(groundUv: boolean, shadow = false): string {
    const index = groundUv
        ? `var hdMaterialIndex = i32(input.v_texId);
    if (input.v_texId == 0u && input.v_hdGroundMaterial > 0u) {
        hdMaterialIndex = 1024 + i32(input.v_hdGroundMaterial);
    }`
        : `let hdMaterialIndex = i32(input.v_texId);`;
    const uv = groundUv
        ? `select((input.v_texCoord - 0.5) / hdScale + 0.5, input.v_hdPosition.xz / hdScale, input.v_hdGroundMaterial > 0u)`
        : `(input.v_texCoord - 0.5) / hdScale + 0.5`;
    // HdShader.ts's terrain block: worldUv materials (castle/red brick) map walls to world
    // space so masonry courses stay level and continuous across cache model faces. Without
    // this, wall textures follow the cache face UVs and come out rotated on some faces.
    const masonry = groundUv
        ? `
    let hdFaceDx = dpdx(input.v_hdPosition);
    let hdFaceDy = dpdy(input.v_hdPosition);
    if (hd.u_hdEnabled > 0.5 && input.v_hdGroundMaterial == 0u && (i32(hdMetadata.y) & 2) != 0) {
        let hdFace = abs(normalize(cross(hdFaceDx, hdFaceDy)));
        hdUv = select(
            vec2<f32>(select(input.v_hdPosition.x, input.v_hdPosition.z, hdFace.x > hdFace.z), -input.v_hdPosition.y) / hdScale,
            input.v_hdPosition.xz / hdScale,
            hdFace.y > 0.7,
        );
    }
`
        : "";
    // Ground blend (terrain variant only): within a 0.35-tile band of the closest tile border,
    // mix the neighbouring tile's HD ground recipe into the albedo. The 0.5 border weight is
    // equal from both sides, so the seam stays continuous while grass fades into dirt.
    // Explicit gradients are evaluated before these per-material branches.
    const groundBlend = groundUv
        ? `
    if (hd.u_hdEnabled > 0.5 && hdLayer != 0.0 && input.v_hdGroundMaterial > 0u) {
        let gmSize = vec2<i32>(textureDimensions(u_mapGroundMaterial, 0));
        let gmPos = input.v_hdPosition.xz - mapU.u_mapPos * 64.0 + vec2<f32>(f32(mapU.u_sceneBorderSize));
        let gmTexel = vec2<i32>(floor(gmPos));
        let gmFract = fract(gmPos);
        let gmEdgeX = min(gmFract.x, 1.0 - gmFract.x);
        let gmEdgeY = min(gmFract.y, 1.0 - gmFract.y);
        var gmNeighbor = gmTexel;
        var gmDist = gmEdgeX;
        if (gmEdgeX < gmEdgeY) {
            gmNeighbor += vec2<i32>(select(1, -1, gmFract.x < 0.5), 0);
        } else {
            gmNeighbor += vec2<i32>(0, select(1, -1, gmFract.y < 0.5));
            gmDist = gmEdgeY;
        }
        if (gmDist < 0.35) {
            let gmLayers = i32(textureNumLayers(u_mapGroundMaterial));
            let gmLayer = clamp(i32(floor(input.v_plane + 0.5)), 0, gmLayers - 1);
            let gmNeighborMaterial = textureLoad(
                u_mapGroundMaterial,
                clamp(gmNeighbor, vec2<i32>(0), gmSize - vec2<i32>(1)),
                gmLayer,
                0,
            ).r;
            if (gmNeighborMaterial > 0u && gmNeighborMaterial != input.v_hdGroundMaterial) {
                let gmNeighborLayer = textureLoad(u_hdMaterials, vec2<i32>(1024 + i32(gmNeighborMaterial), 1), 0).x;
                if (gmNeighborLayer != 0.0) {
                    let gmWeight = 0.5 * (1.0 - smoothstep(0.0, 0.35, gmDist));
                    let gmNeighborColor = hdSampleTexture(gmNeighborLayer, hdUv, hdUvDx, hdUvDy);
                    textureColor = vec4<f32>(mix(textureColor.rgb, gmNeighborColor.rgb, gmWeight), textureColor.a);
                }
            }
        }
    }
`
        : "";
    return `
    ${index}
    var hdMaterial = vec4<f32>(0.0, 1.0, 1.0, 1.0);
    var hdMetadata = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    if (hd.u_hdEnabled > 0.5) {
        hdMaterial = textureLoad(u_hdMaterials, vec2<i32>(hdMaterialIndex, 0), 0);
        hdMetadata = textureLoad(u_hdMaterials, vec2<i32>(hdMaterialIndex, 1), 0);
        ${groundUv ? "if (input.v_texId == 0u && input.v_hdTerrain < 0.5 && input.v_texCoord.y == -1.0) { hdMetadata.y = 5.0; }" : ""}
    }
    let hdLayer = hdMetadata.x;
    var hdScale = hdMaterial.zw;
    hdScale = mix(vec2<f32>(1.0), hdScale, vec2<f32>(
        select(0.0, 1.0, abs(hdScale.x) > 0.001),
        select(0.0, 1.0, abs(hdScale.y) > 0.001),
    ));
    var hdUv = ${uv};${masonry}
    let hdUvDx = ${shadow ? "vec2<f32>(0.0)" : "dpdx(hdUv)"};
    let hdUvDy = ${shadow ? "vec2<f32>(0.0)" : "dpdy(hdUv)"};
${shadow ? "" : `
    // Evaluate gradients before discard; distant fog then skips all texture and lighting work.
    let hdPositionDx = dpdx(input.v_hdPosition);
    let hdPositionDy = dpdy(input.v_hdPosition);
    let hdDistanceFog = select(0.0, hdFogAmount(input.v_hdPosition.xz), input.v_fogAmount > 0.0);
    if (hd.u_hdEnabled > 0.5 && hdDistanceFog >= 1.0) { discard; }
`}
    if (hdLayer != 0.0) {
        textureColor = hdSampleTexture(hdLayer, hdUv, hdUvDx, hdUvDy);
    } else {
        textureColor = sampleModelTexture(input.v_texId, input.v_texCoord);
    }
${groundBlend}
`;
}

// Like 117 HD, replace baked directional shading on textured faces with neutral brightness.
// Otherwise brick walls are lit twice and lose detail.
const PALETTE = `
    if (hd.u_hdEnabled > 0.5 && hdLayer != 0.0 && input.v_texId != 0u) {
        paletteColor = vec3<f32>(90.0 / 127.0);
    }
`;

/**
 * hdShade plus HD fog; `skip` is a WGSL bool for surfaces that keep their own shading.
 * The extended pipeline writes the linear HDR target the tonemap pass consumes, so every
 * path leaves `surface` and `fogColor` linear (hdShade already returns linear HDR).
 */
function shade(skip: string): string {
    return `
    if (hd.u_hdEnabled > 0.5) {
        if (!(${skip})) {
            surface = hdShade(surface * hdMetadata.w, input.v_hdPosition, input.v_hdNormal, hdMaterial, hdMetadata, hdUv, front_facing,
                hdPositionDx, hdPositionDy, hdUvDx, hdUvDy);
            let hdFog = hdDistanceFog;
            let groundFog = smoothstep(0.0, 1.0, (input.v_hdPosition.y - hd.u_hdGroundFog.x) / min(-0.001, hd.u_hdGroundFog.y - hd.u_hdGroundFog.x)) * hd.u_hdGroundFog.z;
            fog = max(fog, max(hdFog, groundFog));
            // The uniform is linearised on the CPU; the scene sky is display-referred.
            fogColor = mix(hd.u_hdFogColor.rgb, pow(max(scene.u_skyColor.rgb, vec3<f32>(0.0)), vec3<f32>(2.2)), hdFog);
        } else {
            // Floor water keeps its own shading: bring it into the same linear space.
            surface = pow(max(surface, vec3<f32>(0.0)), vec3<f32>(2.2));
            fogColor = pow(max(fogColor, vec3<f32>(0.0)), vec3<f32>(2.2));
        }
        // Low-lying mist settles over everything in the hollow, floor water included.
        surface = mix(surface, hd.u_hdFogColor.rgb, hdMistAmount(input.v_hdPosition));
    }
`;
}

/**
 * Shadow map depth: HdShader.ts's u_hdShadowPass blocks. Opaque faces only test vertex alpha;
 * the alpha pass keeps cutouts through the (HD-replaced, animated) texture alpha.
 */
function depth(alpha: boolean): string {
    const body = alpha
        ? `
    if (input.v_texId == 0u) {
        if (input.v_color.a < 0.5) {
            discard;
        }
        return;
    }
    var textureColor = vec4<f32>(1.0);
${materialSetup(false, true)}
    var alpha = textureColor.a * input.v_color.a;
    let material = getMaterial(input.v_texId);
    let frameCount = max(material.frameCount, 1);
    if (frameCount > 1 && hdLayer == 0.0) {
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
    if (alpha < 0.5) {
        discard;
    }
`
        : `
    if (input.v_color.a < 0.5) {
        discard;
    }
`;
    return `
fn sceneDepthPosition(viewPos: vec4<f32>) -> vec4<f32> {
    let clip = hd.u_hdShadowMatrix * vec4<f32>((hd.u_hdInverseView * viewPos).xyz, 1.0);
    // gl-matrix clip coords are GL-style (z in [-w, w]); WebGPU wants [0, w].
    return vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
}

@fragment
fn fs_depth(input: DepthVertexOutput) {${body}}
`;
}

export const HD_SCENE_SHADERS: WebGPUSceneShaders = {
    world: {
        declarations: HD_BINDINGS_WGSL + TERRAIN_WGSL + HD_LIGHTING_WGSL,
        varyings: `
    @location(8) v_hdPosition: vec3<f32>,
    @location(9) v_hdNormal: vec3<f32>,
    @location(10) @interpolate(flat) v_hdGroundMaterial: u32,
    @location(11) @interpolate(flat) v_hdTerrain: f32,`,
        vertex: `
    out.v_hdTerrain = select(0.0, 1.0, modelInfo.contourGround == 3.0);
    out.v_hdGroundMaterial = select(0u, u32(max(round(-vertex.texCoord.x * 64.0), 0.0)), out.v_hdTerrain > 0.5 && vertex.textureId == 0u);
    out.v_hdNormal = vec3<f32>(0.0);
    if (hd.u_hdEnabled > 0.5 && out.v_hdTerrain > 0.5) {
        out.v_hdNormal = hdTerrainNormal(localPos.xz - mapU.u_mapPos * 64.0, modelInfo.plane);
    }
    out.v_hdPosition = select(vec3<f32>(0.0), (hd.u_hdInverseView * viewPos).xyz, hd.u_hdEnabled > 0.5);
`,
        textureSample: materialSetup(true),
        animateTexture: "hdLayer == 0.0",
        palette: PALETTE,
        // Floor water is 117 HD's: core leaves it off, HD turns it on with the toggle.
        floorWater: "hd.u_hdEnabled > 0.5",
        shade: shade("isFloorWater"),
    },
    actor: {
        declarations: HD_BINDINGS_WGSL + HD_LIGHTING_WGSL + ACTOR_WGSL,
        varyings: `
    @location(5) v_hdPosition: vec3<f32>,
    @location(6) v_hdNormal: vec3<f32>,`,
        vertex: `
    out.v_color = vec4<f32>(hdActorColor(vertex, actorHslOverride, extraWord), vertex.color.a);
    out.v_hdPosition = select(vec3<f32>(0.0), (hd.u_hdInverseView * viewPos).xyz, hd.u_hdEnabled > 0.5);
    out.v_hdNormal = vec3<f32>(0.0);
    if (hd.u_hdEnabled > 0.5 && (extraWord >> 16u) != 0u) {
        out.v_hdNormal = hdActorWorldNormal(poseLinear * hdActorNormal(extraWord), actorRotation);
    }
`,
        textureSample: materialSetup(false),
        animateTexture: "hdLayer == 0.0",
        palette: PALETTE,
        shade: shade("false"),
    },
    depth,
};
