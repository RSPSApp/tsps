import { strict as assert } from "node:assert";
import type { Client } from "@runelite/api/Client";
import { SA_ENERGY } from "@runelite/api/gameval/VarPlayerID";
import { ShaderFxConfig } from "../game/plugins/shaderfx/ShaderFxConfig";
import { ShaderFxPlugin } from "../game/plugins/shaderfx/ShaderFxPlugin";
import {
    FxDuration,
    FxSlot,
    SHADER_FX_UNIFORM_FLOATS,
    ShaderFxState,
    fade,
    graphicColor,
} from "../game/plugins/shaderfx/ShaderFxState";
import { SHADERFX_WGSL } from "../render/webgpu/shaders/shaderfx.wgsl";
import { SkillId } from "../rs/skill/skills";

// --- Config ---------------------------------------------------------------------------------------
assert.equal(ShaderFxConfig.group, "shaderfx");
assert.equal(ShaderFxPlugin.descriptor.name, "Shader Effects");
assert.equal(ShaderFxPlugin.descriptor.enabledByDefault, false, "optional: off until the player turns it on");
for (const [key, item] of Object.entries(ShaderFxConfig.items)) {
    assert.ok(item.name && item.description, `${key} has a name and a description`);
    if (item.section) assert.ok(ShaderFxConfig.sections?.[item.section], `${key} points at a real section`);
}
for (const key of ["filmGrain", "scanlines", "staticVignette", "staticChromatic", "sharpen", "tiltShift", "pixelate", "posterize"]) {
    assert.equal(ShaderFxConfig.items[key].default, false, `${key}: the always-on looks start off`);
}

// --- Decay curve ------------------------------------------------------------------------------------
assert.equal(fade(0, 100), 1);
assert.equal(fade(100, 100), 0);
assert.equal(fade(-5, 100), 0, "an impulse in the future has not started");
assert.ok(fade(50, 100) < 0.5 && fade(50, 100) > 0, "eases out");
const [r, g, b] = graphicColor(1234);
assert.ok([r, g, b].every((c) => c >= 0 && c <= 1), "graphic colours are valid rgb");
assert.notDeepEqual(graphicColor(1), graphicColor(2), "neighbouring graphics differ");

// --- State -> uniforms -------------------------------------------------------------------------------
const defaults = {
    intensity: 1, damageVignette: true, damageColor: 0xd01818, hitChromatic: true, hitShake: true,
    hitShockwave: true, hitGlitch: false, bigHitDamage: 15, lowHealth: true, lowHealthPercent: 25,
    dealPunch: true, dealMinDamage: 8, specFlash: true, castGlow: true, castColor: 0x6a5cff,
    castHueFromGraphic: false, rangedFocus: true, levelUpBurst: true, poisonTint: true,
    colorGrade: "none" as const, filmGrain: false, scanlines: false, staticVignette: false,
    staticChromatic: false, sharpen: false, tiltShift: false, pixelate: false, posterize: false,
};
const out = new Float32Array(SHADER_FX_UNIFORM_FLOATS);

let state = new ShaderFxState();
assert.equal(state.fill(out, defaults, 1000), false, "nothing happening: nothing to draw");
assert.equal(out[FxSlot.TAKEN + 3], -1, "no shockwave");
assert.equal(out[FxSlot.EVENTS], -1, "no level-up ring");

assert.deepEqual(
    [out[FxSlot.DAMAGE_COLOR], out[FxSlot.DAMAGE_COLOR + 1], out[FxSlot.DAMAGE_COLOR + 2]].map((v) => Math.round(v * 255)),
    [0xd0, 0x18, 0x18],
    "the damage colour is unpacked into the block",
);

state.hitTaken(5, 15, 1000);
assert.equal(state.fill(out, defaults, 1000), true);
assert.ok(out[FxSlot.TAKEN] > 0, "a small hit flashes the vignette");
assert.equal(out[FxSlot.TAKEN + 1], 0, "but does not split colours");
assert.equal(out[FxSlot.TAKEN + 3], -1, "or ripple");
assert.equal(state.fill(out, defaults, 1000 + FxDuration.DAMAGE + 1), false, "and it fades out");

state = new ShaderFxState();
state.hitTaken(40, 15, 2000);
state.fill(out, defaults, 2000);
assert.ok(out[FxSlot.TAKEN + 1] > 0 && out[FxSlot.TAKEN + 2] > 0, "a big hit splits colours and shakes");
state.fill(out, defaults, 2100);
assert.ok(out[FxSlot.TAKEN + 3] > 0 && out[FxSlot.TAKEN + 3] < 1, "the shockwave travels");
state.fill(out, { ...defaults, hitChromatic: false, hitShake: false, hitShockwave: false, damageVignette: false }, 2000);
assert.equal(out[FxSlot.TAKEN] + out[FxSlot.TAKEN + 1] + out[FxSlot.TAKEN + 2], 0, "each toggle turns its effect off");
assert.equal(out[FxSlot.TAKEN + 3], -1);
state.fill(out, { ...defaults, hitGlitch: true }, 2000);
assert.ok(out[FxSlot.EVENTS + 3] > 0, "glitch is its own toggle");
assert.equal(state.fill(out, { ...defaults, intensity: 0 }, 2000), false, "intensity 0 is off");

state = new ShaderFxState();
state.hitDealt(3, 8, 0);
assert.equal(state.fill(out, defaults, 0), false, "a hit under the threshold does not punch");
state.hitDealt(20, 8, 0);
state.fill(out, defaults, 10);
assert.ok(out[FxSlot.DEALT] > 0, "a solid hit punches");

state.setHealth(30, 100);
assert.equal(state.fill(out, defaults, 5000), false, "30% is above the 25% warning");
state.setHealth(10, 100);
assert.equal(state.fill(out, defaults, 5000), true);
assert.ok(out[FxSlot.DEALT + 1] > 0, "low health warns");
state.setHealth(1, 100);
const nearDeath = out[FxSlot.DEALT + 1];
state.fill(out, defaults, 5000);
assert.ok(out[FxSlot.DEALT + 1] > nearDeath, "and more the lower it is");

state = new ShaderFxState();
state.setPoisoned(true);
state.fill(out, defaults, 0);
assert.ok(out[FxSlot.EVENTS + 1] > 0, "poison haze while poisoned");
state.cast(7, 100, { castHueFromGraphic: false, castColor: 0xff0000 });
state.fill(out, defaults, 100);
assert.deepEqual([out[FxSlot.CAST], out[FxSlot.CAST + 1], out[FxSlot.CAST + 2]], [1, 0, 0], "the chosen spell colour");
assert.ok(out[FxSlot.CAST + 3] > 0, "glow strength");
state.levelUp(0);
state.fill(out, defaults, 100);
assert.ok(out[FxSlot.EVENTS] >= 0 && out[FxSlot.DEALT + 3] > 0, "level-up ring");

state = new ShaderFxState();
const looks = { ...defaults, filmGrain: true, pixelate: true, posterize: true, colorGrade: "noir" as const };
assert.equal(state.fill(out, looks, 0), true, "always-on looks keep the pass running");
assert.ok(out[FxSlot.LOOK_A] > 0 && out[FxSlot.LOOK_B + 2] > 0 && out[FxSlot.LOOK_B + 3] > 0);
assert.equal(out[FxSlot.GRADE], 3, "noir");

// --- Shader source: every uniform field the state fills is declared ----------------------------------
for (const field of ["screen", "time", "taken", "dealt", "events", "spell", "dmg", "lookA", "lookB", "grade"]) {
    assert.ok(SHADERFX_WGSL.includes(`${field}: vec4<f32>`), `shader declares ${field}`);
}
assert.equal((SHADERFX_WGSL.match(/: vec4<f32>,\s+\/\//g) ?? []).length * 4, SHADER_FX_UNIFORM_FLOATS);

// --- Plugin: game events become impulses -------------------------------------------------------------
let now = 10_000;
let hp = 100;
let spec = 1000;
let poison = 0;
let level = 50;
let weaponType = 0;
const client = {
    getBoostedSkillLevel: (skill: SkillId) => (skill === SkillId.Hitpoints ? hp : 1),
    getRealSkillLevel: (skill: SkillId) => (skill === SkillId.Hitpoints ? 100 : skill === SkillId.Attack ? level : 1),
    getVarpValue: (id: number) => (id === SA_ENERGY ? spec : id === 102 ? poison : 0),
    getVarbitValue: (id: number) => (id === 357 ? weaponType : 0),
} as unknown as Client;
const plugin = new ShaderFxPlugin({ client, localPlayerId: () => 7, now: () => now });
assert.equal(plugin.shaderFx(), undefined, "no handle while the plugin is off");
plugin.setEnabledState(true);
const runtime = plugin.shaderFx()!;
assert.ok(runtime, "a handle while on");
assert.equal(runtime.fill(out), false);

plugin.onGameTick(); // baselines
plugin.handleHitsplat({ targetType: "player", targetId: 7, damage: 30 });
assert.equal(runtime.fill(out), true);
assert.ok(out[FxSlot.TAKEN] > 0, "a hit on you");
now += 5000;
plugin.handleHitsplat({ targetType: "player", targetId: 99, damage: 30 });
assert.equal(runtime.fill(out), false, "someone else's hit is not yours");
plugin.handleHitsplat({ targetType: "npc", targetId: 5, damage: 25 });
assert.ok(out[FxSlot.DEALT] >= 0 && runtime.fill(out) && out[FxSlot.DEALT] > 0, "a hit on an NPC punches");

now += 5000;
plugin.onGameTick();
spec = 750;
plugin.onGameTick();
assert.ok(runtime.fill(out) && out[FxSlot.DEALT + 2] > 0, "spending special energy flashes");
now += 5000;
spec = 760; // regenerating is not a spend
plugin.onGameTick();
assert.equal(runtime.fill(out), false);
level = 51;
plugin.onGameTick();
assert.ok(runtime.fill(out) && out[FxSlot.DEALT + 3] > 0, "a level up bursts");
now += 5000;
poison = 6;
hp = 10;
plugin.onGameTick();
assert.ok(runtime.fill(out) && out[FxSlot.EVENTS + 1] > 0 && out[FxSlot.DEALT + 1] > 0, "poisoned and low");
poison = 0;
hp = 100;
plugin.onGameTick();
assert.equal(runtime.fill(out), false, "back to normal");
// A negative varp 102 is an antipoison's immunity timer: not poisoned.
poison = -5;
plugin.onGameTick();
assert.equal(runtime.fill(out), false, "antipoison immunity is not poison");
poison = 0;

// Ranged shot vs spell: both send a projectile and a graphic on the player a few ms apart.
const launch = { source: { actor: { kind: "player", serverId: 7 } } } as never;
const fire = (order: "projectileFirst" | "graphicFirst", weapon: number) => {
    now += 10_000;
    weaponType = weapon;
    plugin.state.reset();
    const projectile = () => (plugin as any).onProjectile(launch);
    const graphic = () => (plugin as any).onGraphic({ type: "player", serverId: 7, graphic: 19 });
    if (order === "projectileFirst") { projectile(); now += 4; graphic(); } else { graphic(); now += 4; projectile(); }
    const o = new Float32Array(40);
    runtime.fill(o);
    return { ranged: o[FxSlot.EVENTS + 2], spell: o[FxSlot.CAST + 3] };
};
for (const order of ["projectileFirst", "graphicFirst"] as const) {
    const bow = fire(order, 3);
    assert.ok(bow.ranged > 0 && bow.spell === 0, `a bow's shot is ranged focus, not a spell (${order})`);
    const staff = fire(order, 18);
    assert.ok(staff.spell > 0 && staff.ranged === 0, `a staff's cast is a spell glow, not ranged focus (${order})`);
}
weaponType = 18;
now += 10_000;
plugin.state.reset();
(plugin as any).onGraphic({ type: "player", serverId: 7, graphic: 111 });
{
    const o = new Float32Array(40);
    runtime.fill(o);
    assert.ok(o[FxSlot.CAST + 3] > 0, "a self-cast (no projectile) glows");
}

plugin.setEnabledState(false);
assert.equal(plugin.shaderFx(), undefined);
console.log("shader-fx-plugin: ok");
