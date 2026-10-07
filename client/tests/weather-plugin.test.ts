import assert from "node:assert/strict";

// Weather assets are PNGs; stub only asset loading before anything imports them.
const storage = new Map<string, string>();
require.extensions[".png"] = (module: any, file: string) => {
    module.exports = file;
};
(globalThis as any).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
};
// PicoGL expects a browser global; the renderer itself is not exercised here.
(globalThis as any).self = globalThis;

const { CacheSystem } = require("../rs/cache/CacheSystem");
const { getCacheLoaderFactory } = require("../rs/cache/loader/CacheLoaderFactory");
const { loadCache, loadCacheInfos, loadCacheList } = require("../scripts/cache/load-util");
const { checkBiome } = require("../game/plugins/weather/BiomeChunkMap");
const { forecastFor } = require("../game/plugins/weather/WeatherForecast");
const { cycleSegment } = require("../game/plugins/weather/WeatherClock");
const {
    Biome,
    Season,
    SoundEffect,
    Weather,
    WEATHER_INFO,
} = require("../game/plugins/weather/WeatherConditions");

// ---- Forecast / biome / clock data -----------------------------------------

const grasslandSpring = forecastFor(Season.SPRING, Biome.GRASSLAND);
assert.ok(grasslandSpring, "Every season x biome needs a forecast");
assert.equal(grasslandSpring.length, 12, "A forecast is twelve 15-minute segments");
assert.equal(grasslandSpring[0], Weather.RAINY);
assert.equal(grasslandSpring[1], Weather.STORMY);
assert.equal(forecastFor(Season.WINTER, Biome.ARCTIC)[0], Weather.SNOWY);
assert.equal(forecastFor(Season.SUMMER, Biome.DESERT)[0], Weather.SUNNY);
assert.equal(forecastFor(Season.AUTUMN, Biome.COSMOS)[0], Weather.STARRY);
for (const season of Object.values(Season)) {
    for (const biome of Object.values(Biome)) {
        const forecast = forecastFor(season as never, biome as never);
        assert.ok(forecast && forecast.length === 12, `${season}/${biome} forecast`);
    }
}

assert.equal(checkBiome(6462), Biome.ARCTIC, "Wintertodt chunk is Arctic");
assert.equal(checkBiome(12850), Biome.GRASSLAND);
assert.equal(checkBiome(12855), Biome.WILDERNESS);
assert.equal(checkBiome(0x7fffff), Biome.CAVE, "Unknown chunks are caves");

// Europe/London in January is GMT, so UTC maps straight through.
assert.equal(cycleSegment(new Date("2026-01-01T00:00:00Z")), 0);
assert.equal(cycleSegment(new Date("2026-01-01T12:30:00Z")), 2);
assert.equal(cycleSegment(new Date("2026-01-01T23:59:00Z")), 11);

assert.equal(WEATHER_INFO[Weather.RAINY].maxObjects, 2000);
assert.equal(WEATHER_INFO[Weather.RAINY].changeRate, 2);
assert.equal(WEATHER_INFO[Weather.RAINY].soundEffect, SoundEffect.RAIN);
assert.equal(WEATHER_INFO[Weather.CLOUDY].hasPrecipitation, true);
assert.equal(WEATHER_INFO[Weather.SUNNY].hasPrecipitation, false);

// ---- Cache models -----------------------------------------------------------

const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const factory = getCacheLoaderFactory(
    cacheInfo,
    CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files),
);
const { WeatherModelBuilder } = require("../game/plugins/weather/WeatherModelBuilder");
const builder = new WeatherModelBuilder(
    factory.getModelLoader(),
    factory.getSeqTypeLoader(),
    factory.getSeqFrameLoader(),
    factory.getTextureLoader(),
);

assert.equal(builder.getFrameCount(Weather.RAINY), 33, "Rain sequence frame count");
assert.equal(builder.getFrameCount(Weather.CLOUDY), 26, "Cloud sequence frame count");
assert.ok(builder.animationDurationMs(Weather.RAINY) > 0);

const rainFrame = builder.getGeometry(Weather.RAINY, 0, false, 0);
assert.ok(rainFrame, "Rain frame 0 builds");
assert.ok(rainFrame.positions.length > 0 && rainFrame.indices.length > 0);
assert.equal(rainFrame.colors.length, (rainFrame.positions.length / 3) * 4);
assert.equal(rainFrame.indices.length, rainFrame.positions.length / 3);

const arraysEqual = (a: Float32Array, b: Float32Array): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);
let rainMoves = false;
let rainFades = false;
for (let frame = 1; frame < 33; frame++) {
    const later = builder.getGeometry(Weather.RAINY, 0, false, frame);
    if (!later) continue;
    if (!arraysEqual(rainFrame.positions, later.positions)) rainMoves = true;
    for (let i = 3; i < rainFrame.colors.length; i += 4) {
        if (rainFrame.colors[i] !== later.colors[i]) rainFades = true;
    }
}
assert.ok(rainMoves, "Rain drops must move between animation frames");
assert.ok(rainFades, "Rain frames must also fade faces in and out");

const transparentCloud = builder.getGeometry(Weather.CLOUDY, 0, true, 0);
assert.ok(transparentCloud, "Transparent cloud variant builds");
let sawTransparentFace = false;
for (let i = 3; i < transparentCloud.colors.length; i += 4) {
    if (transparentCloud.colors[i] < 255) {
        sawTransparentFace = true;
        break;
    }
}
assert.ok(sawTransparentFace, "Transparent cloud faces carry an alpha below 255");
const opaqueCloud = builder.getGeometry(Weather.CLOUDY, 0, false, 0);
assert.ok(opaqueCloud);
assert.equal(opaqueCloud.indices.length, transparentCloud.indices.length);

for (const weather of [Weather.ASHFALL, Weather.SNOWY, Weather.STORMY, Weather.STARRY, Weather.FOGGY]) {
    const geometry = builder.getGeometry(weather, 0, false, 0);
    assert.ok(geometry && geometry.indices.length > 0, `${weather} model builds`);
}
assert.equal(builder.getGeometry(Weather.SUNNY, 0, false, 0), undefined);

// ---- Plugin defaults and config ---------------------------------------------

const { EventBus } = require("../runelite/client/eventbus/EventBus");
const { ConfigManager } = require("../runelite/client/config/ConfigManager");
const { PluginManager } = require("../runelite/client/plugins/PluginManager");
const { PluginInjector, CLIENT_TOKEN } = require("../runelite/client/plugins/PluginInjector");
const { WeatherConfig, WeatherType } = require("../game/plugins/weather/WeatherConfig");
const { WeatherPlugin } = require("../game/plugins/weather/WeatherPlugin");

const eventBus = new EventBus();
const configManager = new ConfigManager(undefined);
const pluginManager = new PluginManager(eventBus, configManager);
const fakeClient = { isOnLoginScreen: () => true };
const injector = new PluginInjector(configManager)
    .provide(CLIENT_TOKEN, fakeClient)
    .provide(PluginManager, pluginManager)
    .provide(ConfigManager, configManager);
const plugin = injector.runWith(() => new WeatherPlugin());

assert.equal(WeatherConfig.group, "3Dweather", "Keep RuneLite's config group");
assert.equal(plugin.isEnabled(), false, "Disabled by default");
assert.equal(plugin.weatherEnabled(Weather.ASHFALL), false, "Ash is disabled upstream");
assert.equal(plugin.weatherEnabled(Weather.FOGGY), false, "Fog is disabled upstream");
assert.equal(plugin.weatherEnabled(Weather.RAINY), true);
assert.equal(plugin.getObjectTarget(Weather.RAINY), 400);
assert.equal(plugin.getObjectTarget(Weather.STORMY), 600);

plugin.setConfigWeather();
const expected = forecastFor(plugin.getState().season, plugin.getState().biome)!;
assert.ok(expected.includes(plugin.getState().weather), "Dynamic weather comes from the forecast");

configManager.setConfigValue(WeatherConfig, "weatherType", WeatherType.STORMY);
plugin.setConfigWeather();
assert.equal(plugin.getState().weather, Weather.STORMY);

configManager.setConfigValue(WeatherConfig, "rainDensity", 123);
assert.equal(plugin.getObjectTarget(Weather.RAINY), 123);

console.log("3D Weather data and model tests passed");
