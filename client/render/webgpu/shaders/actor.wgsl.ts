/**
 * WGSL port of the WebGL actor shaders for the WebGPU backend:
 *   client/render/shaders/npc.vert.glsl        -> vs_npc, vs_gfx (spot animations and projectiles)
 *   client/render/shaders/player.vert.glsl     -> vs_player
 *   client/render/shaders/main.frag.glsl       -> fs_actor (water path omitted; actors never
 *                                                 take the floor-water branch)
 *
 * Self-contained bind group layout (does not touch bindings.ts):
 *   group(0) binding 0  SceneUniforms, same byte layout as main.vert.wgsl (reuses
 *                       WorldResources.sceneBindGroup via a group-equivalent layout)
 *   group(1) bindings 0,1,5  world atlas, material lookup and sampler (reuses
 *                       WorldResources.worldTextureBindGroup via a group-equivalent layout)
 *   group(2) binding 0  ActorUniforms (dynamic offset) per draw entry
 *   group(2) binding 1  per-map r16sint height map, sampled for ground placement
 *   group(3) binding 0  RGBA16UI actor data texture (8 uint16 = 2 texels per actor)
 *   group(3) binding 1  RGBA32F player pose texture (3 texels per label, one row per pose)
 *
 * All kinds share the vertex decode, hsl/fog/height helpers, placement and the fragment shader;
 * players differ in their ground offset sign, depth-only priority bias and GPU posing.
 *
 * `ext` fills the scene-extension slots (../sceneExtension.ts) and `depth` emits the depth entries
 * (vs_*_depth + the extension's fs_depth) instead of the scene ones.
 *
 * Players can be posed on the GPU (port of player.vert.glsl's a_label/u_poseTexture path): the
 * rest-pose mesh carries each vertex's label + 1 at @location(1) and actorU.u_poseRow picks the
 * row of 3x4 label matrices in u_poseTexture (group(3) binding 1); a row < 0 means the mesh was
 * already posed on the CPU.
 */
import type { WebGPUSceneShaders } from "../sceneExtension";

const ACTOR_COMMON_WGSL = `
struct SceneUniforms {
    u_viewProjMatrix: mat4x4<f32>,
    u_viewMatrix: mat4x4<f32>,
    u_projectionMatrix: mat4x4<f32>,
    u_skyColor: vec4<f32>,
    u_sceneHslOverride: vec4<f32>,
    u_cameraPos: vec2<f32>,
    u_playerPos: vec2<f32>,
    u_renderDistance: f32,
    u_fogDepth: f32,
    u_currentTime: f32,
    u_brightness: f32,
    u_colorBanding: f32,
    u_isNewTextureAnim: f32,
};

@group(0) @binding(0) var<uniform> scene: SceneUniforms;

@group(1) @binding(0) var u_textures: texture_2d_array<f32>;
@group(1) @binding(1) var u_textureMaterials: texture_2d<u32>;
@group(1) @binding(5) var u_sampler: sampler;

struct ActorUniforms {
    u_mapPos: vec2<f32>,        // 0
    u_timeLoaded: f32,          // 8
    u_modelYOffset: f32,        // 12
    u_dataOffset: u32,          // 16 absolute actor-data index of this draw's first actor
    u_drawId: u32,              // 20 index within the group (0 for per-actor draws)
    u_subOffset: vec2<f32>,     // 24 projectile fractional tile offset
    u_sceneBorderSize: i32,     // 32
    u_worldEntityOpacity: f32,  // 36
    u_poseRow: i32,             // 40 GPU pose row, -1 when posed on the CPU
    // 1 when this draw is placed through u_worldEntityTransform (a boat deck): its local
    // coordinates can't be measured against the player, so fog is skipped like main.vert.wgsl.
    u_isWorldEntity: u32,       // 44
    u_pad2: vec4<f32>,          // 48..64
    // View-space deck placement for actors aboard a world entity (identity for normal maps):
    // the map-side twin of main.vert.wgsl's mapU.u_worldEntityTransform.
    u_worldEntityTransform: mat4x4<f32>, // 64..128
};

@group(2) @binding(0) var<uniform> actorU: ActorUniforms;
@group(2) @binding(1) var u_mapHeight: texture_2d_array<i32>;

@group(3) @binding(0) var u_actorData: texture_2d<u32>;
@group(3) @binding(1) var u_poseTexture: texture_2d<f32>;

const IDENTITY3: mat3x3<f32> = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);

const TEXTURE_ANIM_UNIT: f32 = 1.0 / 128.0;
const RS_TO_RADIANS: f32 = 0.00306796157;
const FOG_CORNER_ROUNDING: f32 = 0.0;

const PLANE_LAYER_EPSILON: f32 = 0.01;
const PRIORITY_LAYER_EPSILON: f32 = 0.015;
const TOP_PRIORITY_EXTRA_BIAS: f32 = 0.01;

const tileSize: i32 = 128;
const tileSizeShift: u32 = 7u;

// branchless-logic.glsl
fn glslMod(x: f32, y: f32) -> f32 {
    return x - y * floor(x / y);
}

fn glslModVec2(x: vec2<f32>, y: vec2<f32>) -> vec2<f32> {
    return x - y * floor(x / y);
}

fn when_eq(x: f32, y: f32) -> f32 {
    return 1.0 - abs(sign(x - y));
}

fn when_neq(x: f32, y: f32) -> f32 {
    return abs(sign(x - y));
}

fn when_lt(x: f32, y: f32) -> f32 {
    return max(sign(y - x), 0.0);
}

fn when_gt(x: f32, y: f32) -> f32 {
    return max(sign(x - y), 0.0);
}

// hsl-to-rgb.glsl
fn hslToRgb(hsl: i32, brightness: f32) -> vec3<f32> {
    let onethird: f32 = 1.0 / 3.0;
    let twothird: f32 = 2.0 / 3.0;
    let rcpsixth: f32 = 6.0;

    let hue = f32(hsl >> 10) / 64.0 + 0.0078125;
    let sat = f32((hsl >> 7) & 0x7) / 8.0 + 0.0625;
    let lum = f32(hsl & 0x7f) / 128.0;

    var xt = vec3<f32>(
        rcpsixth * (hue - twothird),
        0.0,
        rcpsixth * (1.0 - hue),
    );

    xt = mix(xt, vec3<f32>(
        0.0,
        rcpsixth * (twothird - hue),
        rcpsixth * (hue - onethird),
    ), when_lt(hue, twothird));

    xt = mix(xt, vec3<f32>(
        rcpsixth * (onethird - hue),
        rcpsixth * hue,
        0.0,
    ), when_lt(hue, onethird));

    xt = min(xt, vec3<f32>(1.0));

    let sat2 = 2.0 * sat;
    let satinv = 1.0 - sat;
    let luminv = 1.0 - lum;
    let lum2m1 = (2.0 * lum) - 1.0;
    let ct = (sat2 * xt) + satinv;

    let rgb = mix((luminv * ct) + lum2m1, lum * ct, when_lt(lum, 0.5));

    return pow(rgb, vec3<f32>(brightness));
}

// unpack-float.glsl (GLSL int/uint overloads become distinct names)
fn unpackFloat11(v: u32) -> f32 {
    return 16.0 - f32(v) / 64.0;
}

// material.glsl
struct Material {
    animU: i32,
    animV: i32,
    alphaCutOff: f32,
    frameCount: i32,
    animSpeed: i32,
};

fn getMaterial(textureId: u32) -> Material {
    let data = textureLoad(u_textureMaterials, vec2<i32>(i32(textureId), 0), 0);
    let data1 = textureLoad(u_textureMaterials, vec2<i32>(i32(textureId), 1), 0);

    var material: Material;
    material.animU = i32(data.r);
    material.animV = i32(data.g);
    material.alphaCutOff = f32(data.b & 0xFFu) / 255.0;
    material.frameCount = i32(data.a & 0xFFu);
    material.animSpeed = i32(data1.r & 0xFFu);
    if (material.frameCount == 0) {
        material.frameCount = 1;
    }
    return material;
}

// height-map.glsl
fn getTileHeight(x: i32, z: i32, plane: u32) -> i32 {
    return textureLoad(
        u_mapHeight,
        vec2<i32>(actorU.u_sceneBorderSize + x, actorU.u_sceneBorderSize + z),
        i32(plane),
        0,
    ).r * 8;
}

fn getHeightInterp(pos: vec2<f32>, plane: u32) -> f32 {
    let ipos = vec2<i32>(pos);
    let tileX = ipos.x >> tileSizeShift;
    let tileZ = ipos.y >> tileSizeShift;
    let offsetX = ipos.x & (tileSize - 1);
    let offsetZ = ipos.y & (tileSize - 1);
    let hSW = getTileHeight(tileX, tileZ, plane);
    let hSE = getTileHeight(tileX + 1, tileZ, plane);
    let hNW = getTileHeight(tileX, tileZ + 1, plane);
    let hNE = getTileHeight(tileX + 1, tileZ + 1, plane);

    var h0: i32;
    if (offsetX + offsetZ <= tileSize) {
        h0 = (hSW * tileSize + (hSE - hSW) * offsetX + (hNW - hSW) * offsetZ) >> tileSizeShift;
    } else {
        let rx = tileSize - offsetX;
        let rz = tileSize - offsetZ;
        h0 = (hNE * tileSize + (hNW - hNE) * rx + (hSE - hNE) * rz) >> tileSizeShift;
    }

    var h1: i32;
    if (offsetX <= offsetZ) {
        h1 = (hSW * tileSize + (hNW - hSW) * offsetZ + (hNE - hNW) * offsetX) >> tileSizeShift;
    } else {
        h1 = (hSW * tileSize + (hSE - hSW) * offsetX + (hNE - hSE) * offsetZ) >> tileSizeShift;
    }

    return f32(max(h0, h1));
}

// fog.glsl
fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - r;
}

fn fogFactorOSRS(playerOffset: vec2<f32>) -> f32 {
    let fogStart = min(scene.u_fogDepth, scene.u_renderDistance);
    let fogEnd = max(scene.u_renderDistance, fogStart + 0.0001);
    let rounding = min(FOG_CORNER_ROUNDING, fogEnd);
    let d = sdRoundedBox(playerOffset, vec2<f32>(fogEnd), rounding);
    return clamp(d / (fogEnd - fogStart) + 1.0, 0.0, 1.0);
}

// vertex.glsl
struct Vertex {
    pos: vec3<f32>,
    color: vec4<f32>,
    texCoord: vec2<f32>,
    textureId: u32,
    priority: u32,
};

fn applyHslOverride(hsl: i32, hslOverride: vec4<f32>) -> i32 {
    if (hslOverride.w <= 0.0) {
        return hsl;
    }

    var hue = (hsl >> 10) & 63;
    var sat = (hsl >> 7) & 7;
    var lum = hsl & 127;
    let iAmount = i32(hslOverride.w);

    if (hslOverride.x >= 0.0) {
        hue += (iAmount * (i32(hslOverride.x) - hue)) >> 7;
    }
    if (hslOverride.y >= 0.0) {
        sat += (iAmount * (i32(hslOverride.y) - sat)) >> 7;
    }
    if (hslOverride.z >= 0.0) {
        lum += (iAmount * (i32(hslOverride.z) - lum)) >> 7;
    }

    return (hue << 10) | (sat << 7) | lum;
}

fn decodeVertex(v0: u32, v1: u32, v2: u32, brightness: f32, actorHslOverride: vec4<f32>) -> Vertex {
    let x = f32(i32((v0 >> 17u) & 0x7FFFu) - 0x4000);
    let u = unpackFloat11(((v0 >> 11u) & 0x3Fu) | ((v2 & 0x1Fu) << 6u));
    let v = unpackFloat11(v0 & 0x7FFu);

    let y = -f32(i32(v1 & 0x7FFFu) - 0x4000);
    var hsl = i32((v1 >> 15u) & 0xFFFFu);
    let isTextured = f32((v1 >> 31u) & 0x1u);
    let textureId = f32((hsl >> 7) | i32(((v2 >> 5u) & 0x1u) << 9u)) * isTextured;

    // Actor override first, then scene override, then hslToRgb (OSRS order).
    hsl = applyHslOverride(hsl, actorHslOverride);
    hsl = applyHslOverride(hsl, scene.u_sceneHslOverride);

    let z = f32(i32((v2 >> 17u) & 0x7FFFu) - 0x4000);
    let alpha = f32((v2 >> 9u) & 0xFFu) / 255.0;
    let priority = (v2 >> 6u) & 0x7u;

    let color = vec4<f32>(when_eq(textureId, 0.0)) * vec4<f32>(hslToRgb(hsl, brightness), alpha)
        + vec4<f32>(when_neq(textureId, 0.0)) * vec4<f32>(vec3<f32>(f32(hsl & 0x7F) / 127.0), alpha);

    return Vertex(vec3<f32>(x, y, z), color, vec2<f32>(u, v), u32(textureId), priority);
}

fn getDataTexCoordFromIndex(index: i32) -> vec2<i32> {
    return vec2<i32>(index % 16, index / 16);
}

fn decodeSignedU16(value: u32) -> f32 {
    if ((value & 0x8000u) != 0u) {
        return f32(i32(value) - 65536);
    }
    return f32(i32(value));
}

struct ActorInfo {
    tilePos: vec2<f32>,
    plane: u32,
    rotation: u32,
    hslOverride: vec4<f32>,
};

fn decodeActorInfo(index: i32) -> ActorInfo {
    let baseTexel = index * 2;
    let data = textureLoad(u_actorData, getDataTexCoordFromIndex(baseTexel), 0);
    let data1 = textureLoad(u_actorData, getDataTexCoordFromIndex(baseTexel + 1), 0);

    var info: ActorInfo;
    info.tilePos = vec2<f32>(decodeSignedU16(data.r), decodeSignedU16(data.g));
    info.plane = data.b & 0x3u;
    info.rotation = data.b >> 2u;
    info.hslOverride = vec4<f32>(
        f32(i32(data1.r) & 0x7F),
        f32((i32(data1.r) >> 7) & 0x7F),
        f32(i32(data1.g) & 0x7F),
        f32((i32(data1.g) >> 7) & 0xFF),
    );
    return info;
}

// GLSL row-vector matrix multiply (v * M) reproduced with WGSL matrices, which are
// also column-major: result[j] = dot(v, M[j]).
fn glslRowMul(v: vec4<f32>, m: mat4x4<f32>) -> vec4<f32> {
    return vec4<f32>(dot(v, m[0]), dot(v, m[1]), dot(v, m[2]), dot(v, m[3]));
}

fn rotationY(angle: f32) -> mat4x4<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return mat4x4<f32>(
        vec4<f32>(c, 0.0, s, 0.0),
        vec4<f32>(0.0, 1.0, 0.0, 0.0),
        vec4<f32>(-s, 0.0, c, 0.0),
        vec4<f32>(0.0, 0.0, 0.0, 1.0),
    );
}

fn rotationX(angle: f32) -> mat4x4<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return mat4x4<f32>(
        vec4<f32>(1.0, 0.0, 0.0, 0.0),
        vec4<f32>(0.0, c, -s, 0.0),
        vec4<f32>(0.0, s, c, 0.0),
        vec4<f32>(0.0, 0.0, 0.0, 1.0),
    );
}

fn rotationZ(angle: f32) -> mat4x4<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return mat4x4<f32>(
        vec4<f32>(c, -s, 0.0, 0.0),
        vec4<f32>(s, c, 0.0, 0.0),
        vec4<f32>(0.0, 0.0, 1.0, 0.0),
        vec4<f32>(0.0, 0.0, 0.0, 1.0),
    );
}

fn applyPriorityDepthBias(viewPos: vec4<f32>, priority: u32) -> vec4<f32> {
    let priorityBand = priority & 0x7u;
    if (priorityBand == 0u) {
        return viewPos;
    }
    var layer = f32(priorityBand);
    if (priorityBand == 7u) {
        layer += TOP_PRIORITY_EXTRA_BIAS / PRIORITY_LAYER_EPSILON;
    }
    var out = viewPos;
    out.z += layer * PRIORITY_LAYER_EPSILON;
    return out;
}

fn actorTextureAnimation(vertex: Vertex) -> vec2<f32> {
    let material = getMaterial(vertex.textureId);
    let textureAnimation = vec2<f32>(f32(material.animU), f32(material.animV));
    if (scene.u_isNewTextureAnim > 0.5) {
        return vertex.texCoord
            + glslModVec2(glslMod(scene.u_currentTime, 128.0) * textureAnimation / 64.0, vec2<f32>(1.0));
    }
    return vertex.texCoord + (scene.u_currentTime / 0.02) * textureAnimation * TEXTURE_ANIM_UNIT;
}

fn actorFogAmount(localPos: vec4<f32>) -> f32 {
    if (actorU.u_isWorldEntity != 0u) {
        return 0.0;
    }
    let loadAlpha = smoothstep(0.0, 1.0, min(scene.u_currentTime - actorU.u_timeLoaded, 1.0));
    let isLoading = when_neq(loadAlpha, 1.0);
    let playerOffset = vec2<f32>(localPos.x - scene.u_playerPos.x, localPos.z - scene.u_playerPos.y);
    var fogAmount = fogFactorOSRS(playerOffset);
    fogAmount = isLoading * max(1.0 - loadAlpha, fogAmount) + (1.0 - isLoading) * fogAmount;
    return fogAmount;
}
`;

type ActorKind = "npc" | "gfx" | "player";

/** Kinds whose geometry is the 16-byte actor stride (4th word: HD normal + base HSL). */
const WIDE_KINDS: ReadonlySet<ActorKind> = new Set(["npc", "player"]);

/**
 * WGSL statements that decode and place one actor vertex. Defines `vertex`, `actorRotation`,
 * `actorHslOverride`, `poseLinear`, `localPos`, `viewPos` and `clipPosition` (the scene pass's
 * WebGPU clip position); the depth entries reuse everything but `clipPosition`.
 */
function placement(kind: ActorKind): string {
    const player = kind === "player";
    // player.vert.glsl: GPU-posed vertices are moved by their label's pose matrix, whose
    // rotation also turns their rest-pose normals (poseLinear).
    const pose = player
        ? `
    var vertex = decodeVertex(a_vertex.x, a_vertex.y, a_vertex.z, scene.u_brightness, actorHslOverride);
    var poseLinear = IDENTITY3;
    if (a_label > 0u && actorU.u_poseRow >= 0) {
        let texel = i32(a_label - 1u) * 3;
        let r0 = textureLoad(u_poseTexture, vec2<i32>(texel, actorU.u_poseRow), 0);
        let r1 = textureLoad(u_poseTexture, vec2<i32>(texel + 1, actorU.u_poseRow), 0);
        let r2 = textureLoad(u_poseTexture, vec2<i32>(texel + 2, actorU.u_poseRow), 0);
        let p = vertex.pos;
        vertex.pos = vec3<f32>(dot(r0.xyz, p) + r0.w, dot(r1.xyz, p) + r1.w, dot(r2.xyz, p) + r2.w);
        poseLinear = transpose(mat3x3<f32>(r0.xyz, r1.xyz, r2.xyz));
    }`
        : `
    let vertex = decodeVertex(a_vertex.x, a_vertex.y, a_vertex.z, scene.u_brightness, actorHslOverride);
    let poseLinear = IDENTITY3;`;
    // player.vert.glsl: the equipment face layer biases projected depth only, keeping the
    // original screen position and perspective.
    const clip = player
        ? `
    let depthViewPos = applyPriorityDepthBias(viewPos, vertex.priority);
    let clip = scene.u_projectionMatrix * viewPos;
    let depthClip = scene.u_projectionMatrix * depthViewPos;
    let playerZ = depthClip.z * clip.w / depthClip.w;
    let clipPosition = vec4<f32>(clip.x, clip.y, (playerZ + clip.w) * 0.5, clip.w);`
        : `
    viewPos = applyPriorityDepthBias(viewPos, vertex.priority);
    let clip = scene.u_projectionMatrix * viewPos;
    let clipPosition = vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);`;
    return `
    let info = decodeActorInfo(i32(actorU.u_dataOffset + actorU.u_drawId));
    let actorRotation = info.rotation;
    let actorHslOverride = info.hslOverride;${pose}

    var localPos = glslRowMul(
        vec4<f32>(vertex.pos, 1.0),
        rotationY(f32(actorRotation) * RS_TO_RADIANS),
    ) + vec4<f32>(info.tilePos.x, 0.0, info.tilePos.y, 0.0);

    localPos.y -= getHeightInterp(info.tilePos, info.plane);
    localPos.y ${player ? "+=" : "-="} actorU.u_modelYOffset;

    localPos /= vec4<f32>(128.0, 128.0, 128.0, 1.0);
    localPos += vec4<f32>(actorU.u_mapPos.x * 64.0, 0.0, actorU.u_mapPos.y * 64.0, 0.0);

    var viewPos = actorU.u_worldEntityTransform * (scene.u_viewMatrix * localPos);
    viewPos.z += f32(info.plane) * PLANE_LAYER_EPSILON;${clip}`;
}

function vertexParams(kind: ActorKind): string {
    const wide = WIDE_KINDS.has(kind);
    return `@location(0) a_vertex: vec${wide ? 4 : 3}<u32>${kind === "player" ? ", @location(1) a_label: u32" : ""}`;
}

function sceneVertexEntry(kind: ActorKind, ext?: WebGPUSceneShaders): string {
    return `
@vertex
fn vs_${kind}(${vertexParams(kind)}) -> ActorVertexOutput {${placement(kind)}
    let extraWord = ${WIDE_KINDS.has(kind) ? "a_vertex.w" : "0u"};

    var out: ActorVertexOutput;
    out.position = clipPosition;
    out.v_color = vertex.color;
    out.v_texCoord = actorTextureAnimation(vertex);
    out.v_texId = vertex.textureId;
    out.v_alphaCutOff = getMaterial(vertex.textureId).alphaCutOff;
    out.v_fogAmount = actorFogAmount(localPos);
${ext?.actor.vertex ?? ""}
    return out;
}
`;
}

function depthVertexEntry(kind: ActorKind): string {
    return `
@vertex
fn vs_${kind}_depth(${vertexParams(kind)}) -> DepthVertexOutput {${placement(kind)}
    var out: DepthVertexOutput;
    out.position = sceneDepthPosition(viewPos);
    out.v_color = vertex.color;
    out.v_texCoord = actorTextureAnimation(vertex);
    out.v_texId = vertex.textureId;
    return out;
}
`;
}

function fragmentWgsl(alpha: boolean, ext?: WebGPUSceneShaders): string {
    const slots = ext?.actor;
    const discardBlock = alpha
        ? `
    if ((input.v_texId == 0u && alpha < 0.01) || (textureColor.a < input.v_alphaCutOff)) {
        discard;
    }
`
        : "";

    return `
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
fn fs_actor(input: ActorVertexOutput, @builtin(front_facing) front_facing: bool) -> @location(0) vec4<f32> {
    var textureColor = sampleModelTexture(input.v_texId, input.v_texCoord);
${slots?.textureSample ?? ""}
    var alpha = textureColor.a * input.v_color.a;
${discardBlock}
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
    var surface = applyBrightness(textureColor.rgb, paletteColor);

    var fog = clamp(input.v_fogAmount, 0.0, 1.0);
    fog = smoothstep(0.0, 1.0, fog);
    var fogColor = scene.u_skyColor.rgb;
${slots?.shade ?? ""}
    let finalRgb = mix(surface, fogColor, fog);

    // The extended pipeline feeds the extension's offscreen HDR target and must not clip;
    // the base pipeline writes the canvas display-referred as before.
    return vec4<f32>(${ext ? "finalRgb" : "clamp(finalRgb, vec3<f32>(0.0), vec3<f32>(1.0))"}, alpha);
}
`;
}

const ACTOR_KINDS: ActorKind[] = ["npc", "gfx", "player"];

export const ACTOR_FRAGMENT_ENTRY = "fs_actor";
export const ACTOR_DEPTH_FRAGMENT_ENTRY = "fs_depth";

/** Vertex entry for an actor kind; `depth` picks the depth-pass entry. */
export function actorVertexEntry(kind: ActorKind, depth: boolean = false): string {
    return depth ? `vs_${kind}_depth` : `vs_${kind}`;
}

export type { ActorKind };

export interface ActorShaderOptions {
    /** Adds the WebGL actor alpha-program early-discard behaviour. */
    alpha: boolean;
    /** A scene extension's WGSL slots (../sceneExtension.ts). */
    ext?: WebGPUSceneShaders;
    /** Emits the depth entries instead of the scene ones; needs `ext.depth`. */
    depth?: boolean;
}

export function createActorShaderModule(
    device: GPUDevice,
    options: ActorShaderOptions,
): GPUShaderModule {
    const ext = options.ext;
    const depth = !!options.depth && !!ext?.depth;
    const outputs = `
struct ActorVertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) v_color: vec4<f32>,
    @location(1) v_texCoord: vec2<f32>,
    @location(2) @interpolate(flat) v_texId: u32,
    @location(3) @interpolate(flat) v_alphaCutOff: f32,
    @location(4) v_fogAmount: f32,${ext?.actor.varyings ?? ""}
};

struct DepthVertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) v_color: vec4<f32>,
    @location(1) v_texCoord: vec2<f32>,
    @location(2) @interpolate(flat) v_texId: u32,
};
`;
    const entries = depth
        ? ACTOR_KINDS.map(depthVertexEntry).join("") + ext!.depth!(options.alpha)
        : ACTOR_KINDS.map((kind) => sceneVertexEntry(kind, ext)).join("");
    const code =
        (ext?.actor.declarations ?? "") +
        ACTOR_COMMON_WGSL +
        outputs +
        fragmentWgsl(options.alpha, ext) +
        entries;
    return device.createShaderModule({
        code,
        label: `actor${options.alpha ? "-alpha" : ""}${ext ? "-ext" : ""}${depth ? "-depth" : ""}`,
    });
}
