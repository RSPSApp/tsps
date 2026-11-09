/**
 * WGSL for shaderFxPass.ts: the Shader Effects plugin's screen pass. One fullscreen triangle that
 * reads the scene, bends and tints it, and writes it back.
 *
 * Every effect is driven by the Fx uniform block (ShaderFxState.ts lays it out, slot by slot);
 * an effect whose strength is 0 costs one branch. All sampling is textureSampleLevel so it can sit
 * in non-uniform control flow. Effect strengths are already scaled by the user's intensity.
 *
 * The effects work in linear light. 117 HD hands over linear HDR as it is and takes linear HDR
 * back for its tonemap; the core renderer hands over display colour (grade.z = 1), which is
 * linearised on every read and encoded again on the way out.
 */
export const SHADERFX_WGSL = `
struct Fx {
    screen: vec4<f32>,    // width, height, 1/width, 1/height
    time: vec4<f32>,      // seconds, aspect (w/h), 0, 0
    taken: vec4<f32>,     // damage vignette, big-hit colour split, big-hit shake, shockwave progress (<0 off)
    dealt: vec4<f32>,     // hit punch, low health, special flash, level-up strength
    events: vec4<f32>,    // level-up ring progress (<0 off), poison, ranged focus, glitch
    spell: vec4<f32>,     // spell glow rgb, strength
    dmg: vec4<f32>,       // damage colour rgb, shockwave strength
    lookA: vec4<f32>,     // grain, scanlines, vignette, lens fringe
    lookB: vec4<f32>,     // sharpen, tilt shift, pixel size (0 off), posterize levels (0 off)
    grade: vec4<f32>,     // grade index, grade strength, 1 when the input is display colour (0 for linear HDR), 1 when the player mask is bound
    status: vec4<f32>,    // ice freeze, entangle thorns, teleport warp, ink outlines
    aura: vec4<f32>,      // prayer aura rgb, strength
    loot: vec4<f32>,      // loot flash rgb (scaled by its strength), sweep progress (<0 off)
    focus: vec4<f32>,     // player on screen (u, v from the top, half height as a share of the height), teleport whiteout
};

@group(0) @binding(0) var<uniform> fx: Fx;
@group(1) @binding(0) var t_scene: texture_2d<f32>;
@group(1) @binding(1) var s_scene: sampler;
@group(1) @binding(2) var t_mask: texture_2d<f32>;   // the player's own model as coverage, frame sized (see fx.grade.w)

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}

fn hash12(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn sceneAt(uv: vec2<f32>) -> vec3<f32> {
    let c = textureSampleLevel(t_scene, s_scene, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
    if (fx.grade.z > 0.5) {
        return pow(max(c, vec3<f32>(0.0)), vec3<f32>(2.2));
    }
    return c;
}

fn vnoise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash12(i);
    let b = hash12(i + vec2<f32>(1.0, 0.0));
    let c = hash12(i + vec2<f32>(0.0, 1.0));
    let d = hash12(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Three octaves of value noise, for the prayer smoke.
fn fbm(p: vec2<f32>) -> f32 {
    return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.03 + vec2<f32>(7.1, 3.7)) + 0.15 * vnoise(p * 4.1 + vec2<f32>(13.7, 9.2));
}

fn sdCapsule(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

// A rough signed distance to a standing figure, for the prayer aura: feet at y = -1 and the top of
// the head at y = 1, x to the right, all in half heights. Negative inside.
fn figure(q: vec2<f32>) -> f32 {
    let p = vec2<f32>(abs(q.x), q.y);
    var d = length(q - vec2<f32>(0.0, 0.8)) - 0.17;                      // head
    d = min(d, sdCapsule(p, vec2<f32>(0.0, 0.62), vec2<f32>(0.0, 0.0), 0.25));     // torso
    d = min(d, sdCapsule(p, vec2<f32>(0.11, -0.05), vec2<f32>(0.13, -0.92), 0.1));  // legs
    d = min(d, sdCapsule(p, vec2<f32>(0.31, 0.55), vec2<f32>(0.35, -0.12), 0.07));  // arms
    return d;
}

fn saturate3(c: vec3<f32>, amount: f32) -> vec3<f32> {
    return mix(vec3<f32>(luma(c)), c, amount);
}

// The player mask at a pixel position; 0 off the frame.
fn maskAt(p: vec2<f32>) -> f32 {
    let size = vec2<f32>(textureDimensions(t_mask));
    if (p.x < 0.0 || p.y < 0.0 || p.x >= size.x || p.y >= size.y) {
        return 0.0;
    }
    return textureLoad(t_mask, vec2<i32>(p), 0).r;
}

fn toLinear(c: vec3<f32>) -> vec3<f32> {
    return pow(max(c, vec3<f32>(0.0)), vec3<f32>(2.2));
}

// A heat ramp for the thermal grade: d is display brightness, 0 to 1.
fn thermal(d: f32) -> vec3<f32> {
    var c = mix(vec3<f32>(0.0, 0.0, 0.18), vec3<f32>(0.5, 0.0, 0.6), smoothstep(0.0, 0.3, d));
    c = mix(c, vec3<f32>(0.95, 0.2, 0.1), smoothstep(0.25, 0.55, d));
    c = mix(c, vec3<f32>(1.0, 0.75, 0.1), smoothstep(0.5, 0.8, d));
    return mix(c, vec3<f32>(1.0, 1.0, 0.85), smoothstep(0.78, 1.0, d));
}

// The four Game Boy greens, darkest to lightest.
fn gameBoy(d: f32) -> vec3<f32> {
    let i = i32(floor(clamp(d, 0.0, 0.999) * 4.0));
    if (i == 0) { return vec3<f32>(0.059, 0.220, 0.059); }
    if (i == 1) { return vec3<f32>(0.188, 0.384, 0.188); }
    if (i == 2) { return vec3<f32>(0.545, 0.675, 0.059); }
    return vec3<f32>(0.608, 0.737, 0.059);
}

// The whole-picture colour grades. g is the scene's brightness, used to split shadows and lights.
fn grade(c: vec3<f32>, index: i32) -> vec3<f32> {
    let g = clamp(luma(c), 0.0, 1.0);
    switch index {
        case 1: { // warm
            return c * vec3<f32>(1.10, 1.0, 0.86);
        }
        case 2: { // cool
            return c * vec3<f32>(0.88, 1.0, 1.14);
        }
        case 3: { // noir: near monochrome with punchy contrast
            let m = (luma(c) - 0.18) * 1.35 + 0.18;
            return mix(c, vec3<f32>(max(m, 0.0)), 0.92);
        }
        case 4: { // sepia
            return vec3<f32>(luma(c)) * vec3<f32>(1.25, 1.0, 0.76);
        }
        case 5: { // teal shadows, orange lights
            let t = mix(vec3<f32>(0.80, 1.0, 1.15), vec3<f32>(1.20, 1.0, 0.80), smoothstep(0.08, 0.85, g));
            return c * t;
        }
        case 6: { // vivid
            return (saturate3(c, 1.55) - 0.18) * 1.12 + 0.18;
        }
        case 7: { // dreamy: lifted blacks, softer colour, a cool-warm drift
            return saturate3(c, 0.8) * 0.9 + vec3<f32>(0.035, 0.025, 0.05);
        }
        case 8: { // vaporwave: magenta shadows, cyan lights
            let t = mix(vec3<f32>(1.25, 0.65, 1.15), vec3<f32>(0.70, 1.15, 1.25), smoothstep(0.05, 0.8, g));
            return saturate3(c, 1.2) * t;
        }
        case 9: { // cyberpunk: blue-violet shadows, hot pink lights, extra punch
            let t = mix(vec3<f32>(0.65, 0.75, 1.40), vec3<f32>(1.40, 0.80, 0.95), smoothstep(0.08, 0.7, g));
            return (saturate3(c, 1.3) * t - 0.16) * 1.15 + 0.16;
        }
        case 10: { // golden hour: low amber light with warm lifted shadows
            return saturate3(c, 1.1) * vec3<f32>(1.22, 1.02, 0.72) + vec3<f32>(0.03, 0.012, 0.0);
        }
        case 11: { // bleach bypass: silvery, low colour, hard contrast
            return (mix(vec3<f32>(luma(c)), c, 0.45) - 0.18) * 1.35 + 0.18;
        }
        case 12: { // night vision: bright phosphor green
            let l = clamp(luma(c) * 1.8, 0.0, 1.5);
            return vec3<f32>(0.004, 0.02, 0.006) + vec3<f32>(0.08, 1.0, 0.16) * pow(l, 0.8);
        }
        case 13: { // thermal camera: brightness as heat
            return toLinear(thermal(pow(clamp(luma(c), 0.0, 1.0), 0.45)));
        }
        case 14: { // blood moon: red monochrome
            return mix(vec3<f32>(luma(c)) * vec3<f32>(1.45, 0.22, 0.16), c * vec3<f32>(1.2, 0.5, 0.45), 0.1);
        }
        case 15: { // Game Boy: four greens
            return toLinear(gameBoy(pow(clamp(luma(c), 0.0, 1.0), 0.45)));
        }
        case 16: { // faded film: lifted blacks, low colour, teal shadows and warm lights
            let t = mix(vec3<f32>(0.92, 1.0, 1.06), vec3<f32>(1.08, 1.0, 0.92), smoothstep(0.1, 0.7, g));
            return saturate3(c, 0.7) * 0.88 * t + vec3<f32>(0.04, 0.045, 0.05);
        }
        default: {
            return c;
        }
    }
}

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
    let t = fx.time.x;
    let aspect = fx.time.y;
    var uv = frag.xy * fx.screen.zw;

    // Pixelate: snap to the middle of a block.
    if (fx.lookB.z > 0.5) {
        let cell = fx.lookB.z * fx.screen.zw;
        uv = (floor(uv / cell) + vec2<f32>(0.5)) * cell;
    }

    let centre = vec2<f32>(0.5, 0.5);
    let d0 = uv - centre;
    let r = length(vec2<f32>(d0.x * aspect, d0.y)); // 0 in the middle, about 0.9 in a corner

    // Warps: teleport swirl, poison wobble, hit shake, punch zoom, shockwave ring, glitch tears.
    if (fx.status.z > 0.0) {
        // A swirl strongest in the middle that unwinds as it fades, with a pull in on the centre.
        let tp = fx.status.z;
        let angle = tp * 1.4 * exp(-r * r * 2.5);
        let sn = sin(angle);
        let cs = cos(angle);
        let p = vec2<f32>(d0.x * aspect, d0.y);
        let q = vec2<f32>(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
        uv = centre + vec2<f32>(q.x / aspect, q.y) * (1.0 - tp * 0.1);
    }
    if (fx.events.y > 0.0) {
        uv = uv + fx.events.y * 0.0035 * vec2<f32>(sin(uv.y * 38.0 + t * 3.1), cos(uv.x * 33.0 + t * 2.3));
    }
    if (fx.taken.z > 0.0) {
        uv = uv + fx.taken.z * 0.011 * vec2<f32>(sin(t * 93.0), cos(t * 71.0));
    }
    if (fx.dealt.x > 0.0) {
        uv = centre + (uv - centre) * (1.0 - fx.dealt.x * 0.055);
    }
    if (fx.events.z > 0.0) {
        // Ranged release: a quick push in on the target.
        uv = centre + (uv - centre) * (1.0 - fx.events.z * 0.045);
    }
    if (fx.taken.w >= 0.0) {
        let p = fx.taken.w;
        let x = (r - p * 1.05) / 0.09;
        let ring = exp(-x * x) * (1.0 - p) * fx.dmg.w;
        uv = uv - normalize(d0 + vec2<f32>(0.00001, 0.0)) * ring * 0.03;
    }
    if (fx.events.w > 0.0) {
        let tick = floor(t * 22.0);
        let band = floor(uv.y * 26.0);
        let h = hash12(vec2<f32>(band, tick));
        if (h > 0.8) {
            uv.x = uv.x + (h - 0.9) * 0.34 * fx.events.w;
        }
    }

    let d = uv - centre;

    // Base sample with the colour split: the hit's, plus the lens fringe growing to the edges.
    let split = fx.taken.y * 0.03 + fx.lookA.w * 0.016 * r + fx.status.z * 0.05;
    let ca = d * split;
    var col = vec3<f32>(sceneAt(uv + ca).r, sceneAt(uv).g, sceneAt(uv - ca).b);

    // Radial blur towards the middle: ranged speed lines and the hit punch.
    let blurAmt = fx.events.z * 0.16 * smoothstep(0.08, 0.7, r) + fx.dealt.x * 0.05;
    if (blurAmt > 0.001) {
        var acc = col;
        for (var i = 1; i <= 6; i = i + 1) {
            acc = acc + sceneAt(uv - d * blurAmt * f32(i) / 6.0);
        }
        col = acc / 7.0;
    }

    // Ranged focus: bright speed streaks radiate from the middle, and the edges close in.
    if (fx.events.z > 0.0) {
        let ang = atan2(d0.y, d0.x * aspect);
        let id = floor((ang + 3.14159265) / 6.2831853 * 110.0);
        let h = hash12(vec2<f32>(id, floor(t * 16.0)));
        let streak = step(0.7, h) * smoothstep(0.16, 0.7, r);
        col = col + vec3<f32>(1.0, 0.96, 0.85) * streak * fx.events.z * 0.5;
        col = col * (1.0 - fx.events.z * 0.4 * smoothstep(0.3, 0.95, r));
    }

    // Tilt shift: blur grows away from a sharp band across the middle.
    if (fx.lookB.y > 0.0) {
        let rad = fx.lookB.y * smoothstep(0.12, 0.5, abs(uv.y - 0.5)) * 0.007;
        if (rad > 0.0002) {
            var acc = vec3<f32>(0.0);
            for (var i = 0; i < 8; i = i + 1) {
                let a = f32(i) * 0.7853982;
                acc = acc + sceneAt(uv + vec2<f32>(cos(a) / aspect, sin(a)) * rad);
            }
            col = mix(col, acc / 8.0, min(1.0, fx.lookB.y));
        }
    }

    // Sharpen: add back what a 1px box blur takes away.
    if (fx.lookB.x > 0.0) {
        let px = fx.screen.zw;
        let blur = (sceneAt(uv + vec2<f32>(px.x, 0.0)) + sceneAt(uv - vec2<f32>(px.x, 0.0))
            + sceneAt(uv + vec2<f32>(0.0, px.y)) + sceneAt(uv - vec2<f32>(0.0, px.y))) * 0.25;
        col = col + (col - blur) * fx.lookB.x * 0.8;
    }

    // Ink outlines: dark lines where the brightness jumps, and shading cut into flat bands.
    if (fx.status.w > 0.0) {
        let px = fx.screen.zw * 1.15;
        let lx = pow(luma(sceneAt(uv + vec2<f32>(px.x, 0.0))), 0.45) - pow(luma(sceneAt(uv - vec2<f32>(px.x, 0.0))), 0.45);
        let ly = pow(luma(sceneAt(uv + vec2<f32>(0.0, px.y))), 0.45) - pow(luma(sceneAt(uv - vec2<f32>(0.0, px.y))), 0.45);
        let edge = smoothstep(0.025, 0.1, sqrt(lx * lx + ly * ly));
        let shade = max(luma(col), 0.0001);
        let banded = floor(pow(shade, 0.45) * 5.0 + 0.5) / 5.0;
        col = mix(col, col * (pow(max(banded, 0.02), 2.2) / shade), 0.55 * fx.status.w);
        col = col * (1.0 - edge * 0.96 * fx.status.w);
    }

    // Ice freeze: the colour chills and frost grows in from the edges in jagged crystals.
    if (fx.status.x > 0.0) {
        let f = min(fx.status.x, 1.2);
        let ang = atan2(d0.y, d0.x * aspect);
        let shard = abs(sin(ang * 23.0 + sin(ang * 7.0) * 1.5));
        let facet = 0.5 + 0.5 * sin(uv.x * 61.0 + sin(uv.y * 47.0) * 2.0);
        let twinkle = step(0.992, hash12(floor(frag.xy / 4.0)));
        let reach = 1.02 - f * 0.46;
        let frost = smoothstep(reach, reach + 0.05, r + shard * 0.1 + facet * 0.03);
        let chill = mix(col, saturate3(col, 0.5) * vec3<f32>(0.78, 0.96, 1.22), f * 0.6);
        let ice = vec3<f32>(0.62, 0.84, 1.0) * (0.82 + 0.18 * facet) + vec3<f32>(twinkle * 0.5);
        col = mix(chill, ice, frost * 0.85 * min(f, 1.0));
    }

    // Entangle thorns: dark vines with spikes close in from the edges, and the colour goes mossy.
    if (fx.status.y > 0.0) {
        let th = fx.status.y;
        // Distance to the nearest screen edge in heights, and the spot along that edge.
        let ex = min(uv.x, 1.0 - uv.x) * aspect;
        let ey = min(uv.y, 1.0 - uv.y);
        let e = min(ex, ey);
        let along = select(uv.y, uv.x * aspect, ey < ex);
        let spike = abs(sin(along * 34.0 + sin(along * 9.0) * 1.6));
        let depth = min(th, 1.2) * 0.07 + spike * 0.06 * min(th, 1.0);
        let mask = 1.0 - smoothstep(depth, depth + 0.01, e);
        let thorn = vec3<f32>(0.012, 0.04, 0.008) + vec3<f32>(0.05, 0.03, 0.0) * (1.0 - spike);
        col = mix(col, col * vec3<f32>(0.86, 0.98, 0.78), min(th, 1.0) * 0.25);
        col = col * (1.0 - min(th, 1.0) * 0.4 * (1.0 - smoothstep(0.0, depth * 2.6, e)));
        col = mix(col, thorn, mask * min(1.0, th * 1.6));
    }

    // Poison: a green cast, thicker at the edges.
    if (fx.events.y > 0.0) {
        let edge = smoothstep(0.2, 0.9, r);
        col = mix(col, col * vec3<f32>(0.72, 1.12, 0.62), fx.events.y * 0.45);
        col = col + vec3<f32>(0.02, 0.18, 0.02) * fx.events.y * edge;
    }

    // Low health: the colour drains and a red edge beats like a pulse.
    if (fx.dealt.y > 0.0) {
        let beat = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(t * 5.6), 3.0);
        let edge = smoothstep(0.18, 0.85, r);
        col = saturate3(col, 1.0 - fx.dealt.y * 0.45);
        col = col + fx.dmg.rgb * fx.dealt.y * beat * edge * 0.9;
        col = col * (1.0 - fx.dealt.y * 0.22 * edge);
    }

    // Damage vignette.
    if (fx.taken.x > 0.0) {
        let edge = smoothstep(0.12, 0.8, r);
        col = mix(col, col * 0.45 + fx.dmg.rgb * 0.9, fx.taken.x * edge * 0.7);
        col = col + fx.dmg.rgb * fx.taken.x * 0.06;
    }

    // Special attack: a golden flash from the middle.
    if (fx.dealt.z > 0.0) {
        let gold = vec3<f32>(1.0, 0.74, 0.22);
        col = col + gold * fx.dealt.z * (0.55 * exp(-r * r * 6.0) + 0.1 + 0.25 * smoothstep(0.3, 0.9, r));
    }

    // Spell glow: the spell's colour blooms from the middle and rims the screen.
    if (fx.spell.w > 0.0) {
        col = col + fx.spell.rgb * fx.spell.w * (0.45 * exp(-r * r * 4.0) + 0.3 * smoothstep(0.3, 0.95, r));
    }

    // Level-up: an expanding golden ring over a soft glow.
    if (fx.events.x >= 0.0) {
        let p = fx.events.x;
        let x = (r - p * 1.1) / 0.07;
        let ring = exp(-x * x);
        col = col + vec3<f32>(1.0, 0.86, 0.35) * fx.dealt.w * (ring * 1.6 * (1.0 - p) + 0.18 * exp(-r * r * 3.0));
    }

    // Prayer aura: a glow close around the player with wisps rising off it, in the prayer colour. It
    // follows the player's own model when the mask is bound, else a generic figure.
    if (fx.aura.w > 0.0) {
        let rad = max(fx.focus.z, 0.03);
        let q = vec2<f32>((uv.x - fx.focus.x) * aspect, fx.focus.y - uv.y) / rad; // x right, y up, feet at -1 and head at +1
        let wisps = fbm(vec2<f32>(q.x * 2.6, q.y * 2.0 - t * 1.5));               // climbs with time
        var glow = 0.0;
        var rim = 0.0;
        if (fx.grade.w > 0.5) {
            // Coverage of the mask in rings around this pixel. The taps are taken from lower down, so
            // the glow trails upwards where the wisps are strong.
            let radPx = rad * fx.screen.y;
            if (abs(q.x) < 3.2 && abs(q.y) < 4.0) {
                let shift = (wisps - 0.35) * 0.9 * radPx * (0.4 + 0.6 * smoothstep(-0.5, 1.0, q.y));
                var acc = 0.0;
                var wsum = 0.0;
                var ring0 = 0.0;
                for (var ring = 0; ring < 4; ring = ring + 1) {
                    let f = f32(ring);
                    let r = radPx * (0.04 + 0.05 * f + 0.0067 * f * f);
                    let w = 1.0 - 0.22 * f;
                    var c = 0.0;
                    for (var k = 0; k < 8; k = k + 1) {
                        let a = (f32(k) + 0.5 * f32(ring & 1)) * 0.7853982;
                        c = c + maskAt(frag.xy + vec2<f32>(cos(a), sin(a)) * r + vec2<f32>(0.0, shift));
                    }
                    c = c * 0.125;
                    if (ring == 0) {
                        ring0 = c;
                    }
                    acc = acc + w * c;
                    wsum = wsum + w;
                }
                let inside = maskAt(frag.xy + vec2<f32>(0.0, shift * 0.3));
                glow = (acc / wsum) * (1.0 - inside * 0.8) * 2.4;
                rim = ring0 * (1.0 - inside) * 1.0;
            }
        } else {
            let d = figure(q) + (0.5 - wisps) * 0.28 * (0.5 + 0.5 * smoothstep(-0.5, 1.0, q.y));
            glow = exp(-max(d, 0.0) * 5.5) * mix(0.25, 1.0, smoothstep(-0.12, 0.05, d));
            rim = exp(-abs(d) * 20.0) * 0.7;
        }
        let pulse = 0.9 + 0.1 * sin(t * 2.4);
        let tint = mix(fx.aura.rgb, vec3<f32>(1.0), 0.12);
        col = col + tint * fx.aura.w * (glow * 1.1 + rim) * pulse;
    }

    // Loot flash: a wide soft sweep of light with a thin hot core, and round glints with small star
    // flares that twinkle in its wake. All smooth falloffs, no hard edges.
    if (fx.loot.w >= 0.0) {
        let p = fx.loot.w;
        let along = uv.x + uv.y * 0.45;
        let head = -0.35 + p * 2.2;
        let x = (along - head) / 0.16;
        let body = exp(-x * x);
        let core = exp(-x * x * 9.0);
        let bloom = exp(-x * x * 0.25) * 0.12;
        let behind = head - along;
        let trail = smoothstep(-0.05, 0.12, behind) * (1.0 - smoothstep(0.3, 0.85, behind));
        // Glints on a loose grid, each with its own spot, phase and say in whether it shows.
        let g = vec2<f32>(uv.x * aspect, uv.y) * 16.0;
        let cell = floor(g);
        let h1 = hash12(cell);
        let h2 = hash12(cell + vec2<f32>(17.0, 3.0));
        let h3 = hash12(cell + vec2<f32>(5.0, 29.0));
        let dv = g - (cell + vec2<f32>(0.3 + 0.4 * h1, 0.3 + 0.4 * h2));
        let shows = smoothstep(0.45, 0.6, hash12(cell + vec2<f32>(7.0, 41.0)));
        let life = pow(0.5 + 0.5 * sin(t * 5.0 + h3 * 6.2831853), 3.0);
        let point = exp(-dot(dv, dv) * 90.0);
        let flare = exp(-abs(dv.x) * 8.0) * exp(-dv.y * dv.y * 1200.0) + exp(-abs(dv.y) * 8.0) * exp(-dv.x * dv.x * 1200.0);
        let glint = (point * 0.9 + flare * 0.8) * life * shows * trail;
        let hot = vec3<f32>(1.0, 0.97, 0.9);
        col = col + fx.loot.rgb * (body * 0.55 * (1.0 - p * 0.4) + bloom + glint * 1.6) + hot * fx.loot.rgb * core * 0.7;
    }

    // Teleport whiteout: the picture fades to white as the teleport peaks and back in after landing.
    if (fx.focus.w > 0.0) {
        col = mix(col, vec3<f32>(1.1, 1.06, 1.0), fx.focus.w * 0.9);
    }

    // Always-on: vignette, grade, scanlines, grain, posterize.
    if (fx.lookA.z > 0.0) {
        col = col * (1.0 - fx.lookA.z * 0.62 * smoothstep(0.3, 1.0, r));
    }
    if (fx.grade.y > 0.0) {
        col = mix(col, grade(col, i32(fx.grade.x + 0.5)), fx.grade.y);
    }
    if (fx.lookB.w > 0.5) {
        let levels = fx.lookB.w;
        let display = pow(max(col, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
        col = pow(floor(display * levels + 0.5) / levels, vec3<f32>(2.2));
    }
    if (fx.lookA.y > 0.0 && u32(frag.y) % 3u == 0u) {
        col = col * (1.0 - fx.lookA.y * 0.38);
    }
    if (fx.lookA.x > 0.0) {
        let n = hash12(frag.xy + fract(t) * vec2<f32>(137.1, 91.7)) - 0.5;
        col = col + n * fx.lookA.x * 0.1 * (0.35 + luma(col));
    }

    var result = max(col, vec3<f32>(0.0));
    if (fx.grade.z > 0.5) {
        result = pow(min(result, vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
    }
    return vec4<f32>(result, 1.0);
}
`;
