// Ported to TypeScript from ScreteMonge/3D-Weather (BSD-2-Clause).
// Upstream renders RuneLiteObjects; the equivalent here is the instanced
// WeatherRenderer, and the HUD overlay is a React component.
import { ConfigChanged } from "@runelite/api/events";
import { GameStateChanged } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { PluginManager } from "@runelite/client/plugins/PluginManager";

import type { OsrsClient } from "../../OsrsClient";
import type { ClientPlugin } from "../ClientPluginManager";
import { TILE_FLAG_BRIDGE, TILE_FLAG_UNDER_ROOF } from "../../scene/TileRenderFlags";
import type { WebGLOsrsRenderer } from "../../../render/WebGLOsrsRenderer";
import { AmbientSoundPlayer } from "./AmbientSoundPlayer";
import { checkBiome } from "./BiomeChunkMap";
import { forecastFor } from "./WeatherForecast";
import { WeatherConfig, WeatherType, SeasonType } from "./WeatherConfig";
import { cycleSegment, jagexTime } from "./WeatherClock";
import {
    Biome,
    Season,
    SoundEffect,
    WEATHER_INFO,
    Weather,
    type WeatherInfo,
} from "./WeatherConditions";
import { WeatherModelBuilder } from "./WeatherModelBuilder";
import { WeatherRenderer } from "./WeatherRenderer";

const WINTERTODT_CHUNK = 6462;
const OBJ_ROTATION_CONSTANT = 20;
/** RuneLite's scene is 104 tiles across; weather spawns inside that radius. */
const SCENE_RADIUS_TILES = 52;

export interface WeatherObject {
    /** World tile coordinates (fractional). */
    x: number;
    z: number;
    /** Terrain sample: world-tile height, negative above ground. */
    y: number;
    variant: number;
    phaseMs: number;
}

export interface SceneTile {
    x: number;
    y: number;
    plane: number;
}

class WeatherManager {
    objects: WeatherObject[] = [];
    startRotation = 0;
    fading = false;
    readonly soundPlayer = new AmbientSoundPlayer();

    constructor(readonly weather: Weather) {}

    get info(): WeatherInfo {
        return WEATHER_INFO[this.weather];
    }
}

export interface WeatherPluginState {
    enabled: boolean;
    overlayEnabled: boolean;
    miniOverlay: boolean;
    weather: Weather;
    biome: Biome;
    season: Season;
    /** Increments on each lightning flash. */
    lightning: number;
}

export class WeatherPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "3D Weather",
        description: "Creates immersive 3D Weather with dynamic Weather cycles and ambience",
        tags: ["immersion", "weather", "ambience", "graphics"],
        enabledByDefault: false,
        configKey: "3dweatherplugin",
    };

    static config = WeatherConfig;

    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    private readonly pluginManager = inject(PluginManager);
    private readonly configManager = inject(ConfigManager);
    private readonly config = inject(WeatherConfig);

    private modelBuilder?: WeatherModelBuilder;
    private weatherRenderer?: WeatherRenderer;
    private rendererRef?: WebGLOsrsRenderer;

    private readonly managers: WeatherManager[] = [];
    private gameState: GameState = GameState.UNKNOWN;
    private currentSeason: Season = Season.SPRING;
    private currentBiome: Biome = Biome.GRASSLAND;
    private currentWeather: Weather = Weather.COVERED;
    private savedChunk = 0;
    private savedZPlane = -1;
    private zoneObjRecovery = 0;
    private tickCount = 0;
    private conditionsSynced = false;
    private isPlayerIndoors = false;
    private availableTiles?: { key: string; tiles: SceneTile[] };
    private lightning = 0;

    private readonly listeners = new Set<() => void>();
    private state: WeatherPluginState = {
        enabled: false,
        overlayEnabled: true,
        miniOverlay: false,
        weather: Weather.COVERED,
        biome: Biome.GRASSLAND,
        season: Season.SPRING,
        lightning: 0,
    };

    protected override async startUp(): Promise<void> {
        this.gameState = this.client.isOnLoginScreen() ? GameState.LOGIN_SCREEN : GameState.LOGGED_IN;
        this.commitState();
    }

    protected override async shutDown(): Promise<void> {
        this.clearAllWeatherManagers();
        this.availableTiles = undefined;
        this.savedZPlane = -1;
        this.conditionsSynced = false;
        this.commitState();
    }

    /**
     * Plugins start before the cache is initialised, so the model loaders are
     * only bound on first use.
     */
    private ensureRenderer(): WeatherRenderer | undefined {
        if (this.weatherRenderer) return this.weatherRenderer;
        if (
            !this.client.modelLoader ||
            !this.client.seqTypeLoader ||
            !this.client.seqFrameLoader ||
            !this.client.textureLoader
        ) {
            return undefined;
        }
        this.modelBuilder = new WeatherModelBuilder(
            this.client.modelLoader,
            this.client.seqTypeLoader,
            this.client.seqFrameLoader,
            this.client.textureLoader,
        );
        this.weatherRenderer = new WeatherRenderer(this.modelBuilder);
        return this.weatherRenderer;
    }

    // ---- ClientPlugin hooks -------------------------------------------------

    sceneProgramsReady(renderer: WebGLOsrsRenderer): void {
        this.rendererRef = renderer;
        this.ensureRenderer()?.sceneProgramsReady(renderer);
    }

    disposeRenderer(renderer: WebGLOsrsRenderer): void {
        this.weatherRenderer?.disposeRenderer(renderer);
        if (this.rendererRef === renderer) this.rendererRef = undefined;
    }

    afterSceneRender(renderer: WebGLOsrsRenderer): void {
        this.rendererRef = renderer;
        if (!this.isEnabled() || this.managers.length === 0) return;
        const weatherRenderer = this.ensureRenderer();
        if (!weatherRenderer) return;
        // sceneProgramsReady fires before the cache loaders exist, so the
        // program is created here on first draw (a no-op once it exists).
        weatherRenderer.sceneProgramsReady(renderer);
        weatherRenderer.draw(
            renderer,
            this.managers.map((manager) => ({ weather: manager.weather, objects: manager.objects })),
            performance.now(),
        );
    }

    // ---- RuneLite event handlers -------------------------------------------

    onGameStateChanged(event: GameStateChanged): void {
        this.gameState = event.getGameState();
        if (
            this.gameState === GameState.LOGIN_SCREEN ||
            this.gameState === GameState.STARTING
        ) {
            this.clearAllWeatherManagers();
            return;
        }
        if (this.gameState !== GameState.LOGGED_IN) return;
        this.syncBiome();
        this.syncSeason();
        this.setConfigWeather();
        this.handleWeatherManagers();
        this.handleZoneTransition();
    }

    onGameTick(): void {
        if (!this.isEnabled()) return;
        if (this.gameState !== GameState.LOGGED_IN) return;
        const renderer = this.rendererRef;
        if (!renderer || !this.ensureRenderer()) return;

        this.tickCount++;
        if (!this.conditionsSynced) {
            this.setConfigWeather();
            if (WEATHER_INFO[this.currentWeather].hasPrecipitation) {
                this.handleWeatherManagers();
            }
            this.conditionsSynced = true;
        }

        this.syncSeason();
        this.syncBiome();

        const player = renderer.getPlayerTileXY();
        const plane = renderer.getPlayerRawPlane();
        const playerFlags = renderer.getTileRenderFlagAt(plane, player.x, player.y);
        this.isPlayerIndoors = (playerFlags & TILE_FLAG_UNDER_ROOF) !== 0;

        if (this.config.weatherType() === WeatherType.DYNAMIC) {
            const nextWeather = this.syncWeather(this.currentSeason, this.currentBiome);
            if (nextWeather !== this.currentWeather) {
                this.setConfigWeather();
                this.handleWeatherManagers();
            }
            this.conditionsSynced = true;
        }

        for (const manager of [...this.managers]) {
            if (manager.fading) {
                this.fadeWeatherManager(manager);
            } else {
                this.handleWeatherChanges(manager);
            }
            this.handleSoundChanges(manager);
        }
        this.clearFadedWeatherManagers();

        if (this.savedZPlane !== plane) {
            this.transitionZPlane();
            this.savedZPlane = plane;
        }
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== WeatherConfig.group) return;
        if (this.gameState !== GameState.LOGGED_IN) return;
        const key = event.getKey();

        switch (key) {
            case "weatherType":
                this.setConfigWeather();
                this.handleWeatherManagers();
                this.commitState();
                return;
            case "seasonType":
                this.syncSeason();
                this.commitState();
                return;
            case "disableWeatherUnderground":
                if (!this.config.disableWeatherUnderground()) return;
                if (this.currentBiome === Biome.CAVE || this.currentBiome === Biome.LAVA_CAVE) {
                    this.clearAllWeatherManagers();
                }
                return;
            case "toggleOverlay":
            case "miniOverlay":
                this.commitState();
                return;
            case "toggleAmbience":
                for (const manager of this.managers) {
                    if (!WEATHER_INFO[manager.weather].hasSound) continue;
                    if (this.config.toggleAmbience()) {
                        this.handleSoundChanges(manager);
                    } else {
                        manager.soundPlayer.stopClip();
                    }
                }
                return;
            case "enableLightning":
                this.commitState();
                return;
            case "enableWintertodtSnow":
                if (this.config.enableWintertodtSnow()) return;
                this.forWintertodtSnow((manager) => {
                    this.clearWeatherObjects(manager);
                    manager.soundPlayer.stopClip();
                });
                return;
            case "enableRain":
                this.handleConfigEnableChange(Weather.RAINY, this.config.enableRain());
                this.handleConfigEnableChange(Weather.STORMY, this.config.enableRain());
                return;
            case "enableSnow":
                this.handleConfigEnableChange(Weather.SNOWY, this.config.enableSnow());
                return;
            case "enableClouds":
                this.handleConfigEnableChange(Weather.CLOUDY, this.config.enableClouds());
                this.handleConfigEnableChange(Weather.PARTLY_CLOUDY, this.config.enableClouds());
                return;
            case "enableAsh":
                this.handleConfigEnableChange(Weather.ASHFALL, this.config.enableAsh());
                return;
            case "enableFog":
                this.handleConfigEnableChange(Weather.FOGGY, this.config.enableFog());
                return;
            case "enableStars":
                this.handleConfigEnableChange(Weather.STARRY, this.config.enableStars());
                return;
            case "ashfallDensity":
                this.handleConfigDensityChange(Weather.ASHFALL, this.config.ashfallDensity());
                return;
            case "rainDensity":
                this.handleConfigDensityChange(Weather.RAINY, this.config.rainDensity());
                return;
            case "stormDensity":
                this.handleConfigDensityChange(Weather.STORMY, this.config.stormDensity());
                return;
            case "snowDensity":
                this.handleConfigDensityChange(Weather.SNOWY, this.config.snowDensity());
                return;
            case "partlyCloudyDensity":
                this.handleConfigDensityChange(Weather.PARTLY_CLOUDY, this.config.partlyCloudyDensity());
                return;
            case "cloudyDensity":
                this.handleConfigDensityChange(Weather.CLOUDY, this.config.cloudyDensity());
                return;
            case "foggyDensity":
                this.handleConfigDensityChange(Weather.FOGGY, this.config.foggyDensity());
                return;
            case "starryDensity":
                this.handleConfigDensityChange(Weather.STARRY, this.config.starryDensity());
                return;
            default:
        }
    }

    // ---- HUD state ----------------------------------------------------------

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getState(): WeatherPluginState {
        return this.state;
    }

    private commitState(): void {
        this.state = {
            enabled: this.isEnabled(),
            overlayEnabled: this.config.toggleOverlay(),
            miniOverlay: this.config.miniOverlay(),
            weather: this.currentWeather,
            biome: this.currentBiome,
            season: this.currentSeason,
            lightning: this.lightning,
        };
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (error) {
                console.error("[3d-weather] listener failed", error);
            }
        }
    }

    // ---- Weather selection --------------------------------------------------

    weatherEnabled(weather: Weather): boolean {
        switch (weather) {
            case Weather.ASHFALL:
                return this.config.enableAsh();
            case Weather.FOGGY:
                return this.config.enableFog();
            case Weather.RAINY:
            case Weather.STORMY:
                return this.config.enableRain();
            case Weather.SNOWY:
                return this.config.enableSnow();
            case Weather.CLOUDY:
            case Weather.PARTLY_CLOUDY:
                return this.config.enableClouds();
            case Weather.STARRY:
                return this.config.enableStars();
            default:
            case Weather.COVERED:
            case Weather.SUNNY:
                return true;
        }
    }

    getObjectTarget(weather: Weather): number {
        switch (weather) {
            case Weather.ASHFALL:
                return this.config.ashfallDensity();
            case Weather.FOGGY:
                return this.config.foggyDensity();
            case Weather.RAINY:
                return this.config.rainDensity();
            case Weather.SNOWY:
                return this.config.snowDensity();
            case Weather.CLOUDY:
                return this.config.cloudyDensity();
            case Weather.STARRY:
                return this.config.starryDensity();
            case Weather.STORMY:
                return this.config.stormDensity();
            case Weather.PARTLY_CLOUDY:
                return this.config.partlyCloudyDensity();
            default:
            case Weather.SUNNY:
            case Weather.COVERED:
                return 0;
        }
    }

    setConfigWeather(): void {
        switch (this.config.weatherType()) {
            case WeatherType.ASHFALL:
                this.currentWeather = Weather.ASHFALL;
                break;
            case WeatherType.CLOUDY:
                this.currentWeather = Weather.CLOUDY;
                break;
            case WeatherType.CLEAR:
                this.currentWeather = Weather.SUNNY;
                break;
            case WeatherType.FOGGY:
                this.currentWeather = Weather.FOGGY;
                break;
            case WeatherType.PARTLY_CLOUDY:
                this.currentWeather = Weather.PARTLY_CLOUDY;
                break;
            case WeatherType.RAINY:
                this.currentWeather = Weather.RAINY;
                break;
            case WeatherType.SNOWY:
                this.currentWeather = Weather.SNOWY;
                break;
            case WeatherType.STARRY:
                this.currentWeather = Weather.STARRY;
                break;
            case WeatherType.STORMY:
                this.currentWeather = Weather.STORMY;
                break;
            default:
            case WeatherType.DYNAMIC:
                this.currentWeather = this.syncWeather(this.currentSeason, this.currentBiome);
                break;
        }
        this.commitState();
    }

    private syncWeather(season: Season, biome: Biome): Weather {
        const forecast = forecastFor(season, biome);
        if (!forecast || forecast.length === 0) return Weather.COVERED;
        return forecast[cycleSegment() % forecast.length];
    }

    private syncBiome(): void {
        const renderer = this.rendererRef;
        if (!renderer) return;
        const player = renderer.getPlayerTileXY();
        const playerChunk = ((player.x >> 6) << 8) | (player.y >> 6);
        if (this.savedChunk !== playerChunk) {
            this.currentBiome = checkBiome(playerChunk);
            this.savedChunk = playerChunk;
            this.commitState();
        }
    }

    private syncSeason(): void {
        const hdEnabled = this.pluginManager
            .getPlugins()
            .some((plugin) => plugin.getName() === "117 HD" && this.pluginManager.isEnabled(plugin));
        let seasonType = this.config.seasonType();
        if (seasonType === SeasonType.HD_117 && !hdEnabled) seasonType = SeasonType.DYNAMIC;

        switch (seasonType) {
            case SeasonType.SPRING:
                this.setSeason(Season.SPRING);
                return;
            case SeasonType.SUMMER:
                this.setSeason(Season.SUMMER);
                return;
            case SeasonType.AUTUMN:
                this.setSeason(Season.AUTUMN);
                return;
            case SeasonType.WINTER:
                this.setSeason(Season.WINTER);
                return;
            case SeasonType.HD_117: {
                // Upstream delegates to 117 HD's seasonalTheme; without it,
                // RuneLite's AUTOMATIC logic is the best available match.
                const theme = this.configManager.getConfiguration("hd", "seasonalTheme") ?? "AUTOMATIC";
                if (theme === "SUMMER") return this.setSeason(Season.SUMMER);
                if (theme === "WINTER") return this.setSeason(Season.WINTER);
                if (theme === "AUTUMN") return this.setSeason(Season.AUTUMN);
                const month = new Date().getUTCMonth();
                if (month === 8 || month === 9 || month === 10) return this.setSeason(Season.AUTUMN);
                if (month === 11 || month === 0 || month === 1) return this.setSeason(Season.WINTER);
                return this.setSeason(Season.SUMMER);
            }
            default:
            case SeasonType.DYNAMIC: {
                const { days } = jagexTime();
                const seasons = [Season.SPRING, Season.SUMMER, Season.AUTUMN, Season.WINTER];
                this.setSeason(seasons[Math.floor(days / 7) % 4]);
                return;
            }
        }
    }

    private setSeason(season: Season): void {
        if (this.currentSeason === season) return;
        this.currentSeason = season;
        this.commitState();
    }

    // ---- Weather managers ---------------------------------------------------

    handleWeatherManagers(): void {
        let activeManager = false;
        for (const manager of this.managers) {
            manager.fading = true;
            if (manager.weather === this.currentWeather) {
                manager.fading = false;
                activeManager = true;
            }
        }
        if (!activeManager && WEATHER_INFO[this.currentWeather].hasPrecipitation) {
            this.createWeatherManager();
        }
    }

    private createWeatherManager(): void {
        this.managers.push(new WeatherManager(this.currentWeather));
        this.commitState();
    }

    private fadeWeatherManager(manager: WeatherManager): void {
        let trimNumber = manager.info.maxObjects / OBJ_ROTATION_CONSTANT;
        if (trimNumber < manager.objects.length / OBJ_ROTATION_CONSTANT) {
            trimNumber = manager.objects.length / OBJ_ROTATION_CONSTANT;
        }
        if (trimNumber === 0) trimNumber = 1;
        this.trimWeatherArray(manager, 0, Math.floor(trimNumber));
    }

    private clearFadedWeatherManagers(): void {
        for (let i = 0; i < this.managers.length; i++) {
            const manager = this.managers[i];
            if (!manager.fading || manager.objects.length > 0) continue;
            if (!manager.soundPlayer.isPlaying()) {
                this.managers.splice(i, 1);
                i--;
            }
        }
    }

    clearAllWeatherManagers(): void {
        for (const manager of this.managers) {
            this.clearWeatherObjects(manager);
            manager.soundPlayer.stopClip();
        }
        this.managers.length = 0;
        this.commitState();
    }

    private handleWeatherChanges(manager: WeatherManager): void {
        const weather = manager.weather;
        if (
            this.config.weatherType() !== WeatherType.DYNAMIC &&
            this.config.disableWeatherUnderground() &&
            (this.currentBiome === Biome.CAVE || this.currentBiome === Biome.LAVA_CAVE)
        ) {
            return;
        }
        if (!this.weatherEnabled(weather)) return;
        if (!this.config.enableWintertodtSnow() && weather === Weather.SNOWY && this.isAtWintertodt()) {
            return;
        }

        const objectTarget = this.getObjectTarget(weather);
        const objects = manager.objects;
        if (objects.length < objectTarget) {
            if (this.zoneObjRecovery > 0) {
                this.relocateObjects(manager, Math.floor(objectTarget / (OBJ_ROTATION_CONSTANT / 2)));
                this.zoneObjRecovery--;
            }
            this.renderWeather(manager, Math.floor(objectTarget / OBJ_ROTATION_CONSTANT));
        } else if (objects.length === objectTarget && this.tickCount % manager.info.changeRate === 0) {
            this.relocateObjects(manager, Math.floor(objectTarget / OBJ_ROTATION_CONSTANT));
        }
    }

    private renderWeather(manager: WeatherManager, count: number): void {
        if (!this.rendererRef) return;
        const weather = manager.weather;
        const available = this.getAvailableTiles();
        if (available.length === 0) return;
        const target = this.getObjectTarget(weather);
        let alternate = 1;
        for (let i = 0; i < count; i++) {
            const tile = available[(Math.random() * available.length) | 0];
            manager.objects.push(this.createWeatherObject(weather, tile, alternate));
            alternate++;
            if (alternate > manager.info.modelVariety) alternate = 1;
            if (manager.objects.length === target) return;
        }
    }

    private createWeatherObject(weather: Weather, tile: SceneTile, variant: number): WeatherObject {
        const renderer = this.rendererRef!;
        const x = tile.x + 0.5;
        const z = tile.y + 0.5;
        const y = renderer.sampleHeightAtExactPlane(x, z, tile.plane);
        const phaseMs = Math.random() * (this.modelBuilder?.animationDurationMs(weather) ?? 0);
        return { x, z, y, variant, phaseMs };
    }

    private removeWeatherObject(index: number, objects: WeatherObject[]): void {
        if (index >= objects.length) return;
        objects.splice(index, 1);
    }

    private clearWeatherObjects(manager: WeatherManager): void {
        manager.objects.length = 0;
    }

    private trimWeatherArray(manager: WeatherManager, start: number, end: number): void {
        for (let i = start; i < end; i++) {
            this.removeWeatherObject(start, manager.objects);
            if (manager.objects.length === 0) return;
        }
    }

    private relocateObjects(manager: WeatherManager, numToRelocate: number): void {
        const renderer = this.rendererRef;
        if (!renderer) return;
        const weather = manager.weather;
        const beginRotation = manager.startRotation;
        const objects = manager.objects;
        const available = this.getAvailableTiles();
        if (available.length === 0) return;

        for (let i = beginRotation; i < beginRotation + numToRelocate; i++) {
            const tile = available[(Math.random() * available.length) | 0];
            if (i >= objects.length) break;
            const object = objects[i];
            object.x = tile.x + 0.5;
            object.z = tile.y + 0.5;
            object.y = renderer.sampleHeightAtExactPlane(object.x, object.z, tile.plane);
            object.phaseMs = Math.random() * (this.modelBuilder?.animationDurationMs(weather) ?? 0);
        }
        manager.startRotation = beginRotation + numToRelocate;
        if (beginRotation > this.getObjectTarget(weather)) manager.startRotation = 0;
    }

    private transitionZPlane(): void {
        if (!WEATHER_INFO[this.currentWeather].hasPrecipitation) {
            this.clearAllWeatherManagers();
            return;
        }
        this.handleZoneTransition();
    }

    private handleZoneTransition(): void {
        if (
            this.config.weatherType() !== WeatherType.DYNAMIC &&
            this.config.disableWeatherUnderground() &&
            (this.currentBiome === Biome.CAVE || this.currentBiome === Biome.LAVA_CAVE)
        ) {
            this.clearAllWeatherManagers();
            return;
        }
        for (const manager of this.managers) {
            const size = Math.floor(manager.objects.length * 0.8);
            const isCurrent = manager.weather === this.currentWeather;
            this.clearWeatherObjects(manager);
            if (isCurrent) {
                this.renderWeather(manager, Math.max(0, size));
                this.zoneObjRecovery = 4;
            }
        }
    }

    // ---- Tiles --------------------------------------------------------------

    private getAvailableTiles(): SceneTile[] {
        const renderer = this.rendererRef;
        if (!renderer) return [];
        const player = renderer.getPlayerTileXY();
        const plane = renderer.getPlayerRawPlane();
        const cacheKey = `${player.x}|${player.y}|${plane}`;
        if (this.availableTiles?.key === cacheKey) return this.availableTiles.tiles;

        const tiles: SceneTile[] = [];
        const cull = renderer.getRenderCullTile();
        const distance = Math.min(renderer.getFrameRenderDistanceTiles(), SCENE_RADIUS_TILES);
        for (let z = 0; z <= plane; z++) {
            for (let i = 0; i < renderer.mapManager.visibleMapCount; i++) {
                const map = renderer.mapManager.visibleMaps[i];
                if (!renderer.isMapWithinRenderDistance(map, cull.x, cull.y, distance, 0)) continue;
                const baseX = Math.floor(map.getRenderBaseWorldX?.() ?? map.mapX * 64);
                const baseY = Math.floor(map.getRenderBaseWorldY?.() ?? map.mapY * 64);
                const span = map.getLocalTileSpan();
                for (let localX = 0; localX < span; localX++) {
                    const x = baseX + localX;
                    if (Math.abs(x - player.x) > SCENE_RADIUS_TILES) continue;
                    for (let localY = 0; localY < span; localY++) {
                        const y = baseY + localY;
                        if (Math.abs(y - player.y) > SCENE_RADIUS_TILES) continue;
                        const flags = renderer.getTileRenderFlagAt(z, x, y);
                        if ((flags & TILE_FLAG_UNDER_ROOF) !== 0) continue;
                        if (plane > 0 && this.hasBridgeColumn(renderer, x, y)) continue;
                        tiles.push({ x, y, plane: z });
                    }
                }
            }
        }
        this.availableTiles = { key: cacheKey, tiles };
        return tiles;
    }

    private hasBridgeColumn(renderer: WebGLOsrsRenderer, x: number, y: number): boolean {
        for (let level = 0; level < 4; level++) {
            if ((renderer.getTileRenderFlagAt(level, x, y) & TILE_FLAG_BRIDGE) !== 0) return true;
        }
        return false;
    }

    private isAtWintertodt(): boolean {
        const renderer = this.rendererRef;
        if (!renderer) return false;
        const player = renderer.getPlayerTileXY();
        return (((player.x >> 6) << 8) | (player.y >> 6)) === WINTERTODT_CHUNK;
    }

    private forWintertodtSnow(action: (manager: WeatherManager) => void): void {
        if (!this.isAtWintertodt()) return;
        for (const manager of this.managers) {
            if (manager.weather === Weather.SNOWY) action(manager);
        }
    }

    // ---- Audio --------------------------------------------------------------

    private handleSoundChanges(manager: WeatherManager): void {
        manager.soundPlayer.tick();
        const weather = manager.weather;
        if (!manager.info.hasSound || !this.config.toggleAmbience()) return;
        if (
            this.config.weatherType() !== WeatherType.DYNAMIC &&
            this.config.disableWeatherUnderground() &&
            (this.currentBiome === Biome.CAVE || this.currentBiome === Biome.LAVA_CAVE)
        ) {
            return;
        }

        if (weather !== this.currentWeather) {
            manager.soundPlayer.fadeTo(0, 6000);
            return;
        }

        const outdoor = manager.info.soundEffect;
        if (!outdoor) return;
        let appropriate = outdoor;
        if (this.isPlayerIndoors && !this.config.disableIndoorMuffling()) {
            if (outdoor === SoundEffect.RAIN) appropriate = SoundEffect.RAIN_MUFFLED;
            else if (outdoor === SoundEffect.THUNDERSTORM) {
                appropriate = SoundEffect.THUNDERSTORM_MUFFLED;
            } else if (outdoor === SoundEffect.WIND) appropriate = SoundEffect.WIND_MUFFLED;
        }

        const goal = this.getVolumeGoal(weather);
        const player = manager.soundPlayer;
        if (player.getCurrentTrack() !== appropriate) {
            player.playClip(appropriate, 0);
            player.timer = 0;
            player.fadeTo(goal, 6000);
        } else if (Math.abs(player.getCurrentVolume() - goal) > 1) {
            player.fadeTo(goal, 6000);
        }

        // Upstream flashes at the same two points in every thunder loop (tick 230 restarts it).
        if (weather === Weather.STORMY && this.config.enableLightning()) {
            if (player.timer === 90 || player.timer === 138) {
                this.lightning++;
                this.commitState();
            }
        }
        if (player.timer > 230) player.timer = 0;
    }

    private getVolumeGoal(weather: Weather): number {
        const info = WEATHER_INFO[weather];
        const factor = Math.min(1, info.maxObjects / Math.max(1, info.maxObjectVolume));
        return Math.round(this.config.ambientVolume() * factor);
    }

    private handleConfigEnableChange(weather: Weather, enabled: boolean): void {
        if (enabled) return;
        for (const manager of this.managers) {
            if (manager.weather === weather) {
                this.clearWeatherObjects(manager);
                manager.soundPlayer.stopClip();
            }
        }
    }

    private handleConfigDensityChange(weather: Weather, newDensity: number): void {
        for (const manager of this.managers) {
            if (manager.weather !== weather) continue;
            while (manager.objects.length > newDensity) {
                this.removeWeatherObject(0, manager.objects);
            }
        }
    }
}


