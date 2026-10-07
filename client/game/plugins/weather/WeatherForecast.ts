// Ported to TypeScript from ScreteMonge/3D-Weather (BSD-2-Clause).
import { Biome, Season, Weather } from "./WeatherConditions";

export type WeatherForecast = readonly [Season, Biome, ReadonlyArray<Weather>];

/** Twelve 15-minute weather segments per season x biome, as in RuneLite. */
export const WEATHER_FORECASTS: ReadonlyArray<WeatherForecast> = [
    [Season.SPRING, Biome.ARCTIC, [Weather.CLOUDY, Weather.SNOWY, Weather.SNOWY, Weather.CLOUDY, Weather.PARTLY_CLOUDY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.FOGGY, Weather.SNOWY, Weather.PARTLY_CLOUDY, Weather.FOGGY, Weather.CLOUDY]],
    [Season.SPRING, Biome.BARRENS, [Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.CLOUDY, Weather.RAINY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SUNNY, Weather.STORMY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.PARTLY_CLOUDY]],
    [Season.SPRING, Biome.CAVE, [Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED]],
    [Season.SPRING, Biome.COSMOS, [Weather.STARRY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.STARRY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY]],
    [Season.SPRING, Biome.DESERT, [Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.CLOUDY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY]],
    [Season.SPRING, Biome.FOREST, [Weather.SUNNY, Weather.FOGGY, Weather.RAINY, Weather.RAINY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.RAINY, Weather.PARTLY_CLOUDY, Weather.CLOUDY, Weather.RAINY, Weather.STORMY, Weather.CLOUDY]],
    [Season.SPRING, Biome.GRASSLAND, [Weather.RAINY, Weather.STORMY, Weather.SUNNY, Weather.CLOUDY, Weather.FOGGY, Weather.SUNNY, Weather.RAINY, Weather.CLOUDY, Weather.RAINY, Weather.PARTLY_CLOUDY, Weather.FOGGY, Weather.SUNNY]],
    [Season.SPRING, Biome.LAVA_CAVE, [Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED]],
    [Season.SPRING, Biome.MOUNTAIN, [Weather.STORMY, Weather.SNOWY, Weather.CLOUDY, Weather.SNOWY, Weather.PARTLY_CLOUDY, Weather.FOGGY, Weather.CLOUDY, Weather.SNOWY, Weather.SNOWY, Weather.STORMY, Weather.SUNNY, Weather.CLOUDY]],
    [Season.SPRING, Biome.SWAMP, [Weather.FOGGY, Weather.RAINY, Weather.CLOUDY, Weather.PARTLY_CLOUDY, Weather.FOGGY, Weather.SUNNY, Weather.RAINY, Weather.CLOUDY, Weather.FOGGY, Weather.RAINY, Weather.PARTLY_CLOUDY, Weather.FOGGY]],
    [Season.SPRING, Biome.TROPICAL, [Weather.RAINY, Weather.STORMY, Weather.RAINY, Weather.CLOUDY, Weather.STORMY, Weather.RAINY, Weather.RAINY, Weather.SUNNY, Weather.CLOUDY, Weather.SUNNY, Weather.SUNNY, Weather.CLOUDY]],
    [Season.SPRING, Biome.WILDERNESS, [Weather.ASHFALL, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.ASHFALL, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.ASHFALL, Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.ASHFALL, Weather.SUNNY]],
    [Season.SUMMER, Biome.ARCTIC, [Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.RAINY, Weather.FOGGY, Weather.SUNNY, Weather.CLOUDY, Weather.STORMY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.STORMY]],
    [Season.SUMMER, Biome.BARRENS, [Weather.SUNNY, Weather.SUNNY, Weather.CLOUDY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.STORMY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.STORMY, Weather.CLOUDY]],
    [Season.SUMMER, Biome.CAVE, [Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED]],
    [Season.SUMMER, Biome.COSMOS, [Weather.STARRY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.STARRY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY]],
    [Season.SUMMER, Biome.DESERT, [Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SUNNY, Weather.CLOUDY, Weather.SUNNY, Weather.PARTLY_CLOUDY]],
    [Season.SUMMER, Biome.FOREST, [Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.CLOUDY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.RAINY, Weather.STORMY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.RAINY]],
    [Season.SUMMER, Biome.GRASSLAND, [Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.RAINY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.CLOUDY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SUNNY, Weather.STORMY, Weather.RAINY, Weather.PARTLY_CLOUDY]],
    [Season.SUMMER, Biome.LAVA_CAVE, [Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED]],
    [Season.SUMMER, Biome.MOUNTAIN, [Weather.RAINY, Weather.CLOUDY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.STORMY, Weather.RAINY, Weather.CLOUDY, Weather.FOGGY, Weather.RAINY, Weather.FOGGY, Weather.PARTLY_CLOUDY, Weather.SUNNY]],
    [Season.SUMMER, Biome.SWAMP, [Weather.SUNNY, Weather.FOGGY, Weather.PARTLY_CLOUDY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.FOGGY, Weather.RAINY, Weather.CLOUDY, Weather.RAINY, Weather.CLOUDY, Weather.PARTLY_CLOUDY, Weather.RAINY]],
    [Season.SUMMER, Biome.TROPICAL, [Weather.STORMY, Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.STORMY, Weather.RAINY, Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SUNNY, Weather.RAINY]],
    [Season.SUMMER, Biome.WILDERNESS, [Weather.ASHFALL, Weather.ASHFALL, Weather.ASHFALL, Weather.SUNNY, Weather.SUNNY, Weather.ASHFALL, Weather.SUNNY, Weather.ASHFALL, Weather.ASHFALL, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY]],
    [Season.AUTUMN, Biome.ARCTIC, [Weather.FOGGY, Weather.PARTLY_CLOUDY, Weather.CLOUDY, Weather.SNOWY, Weather.PARTLY_CLOUDY, Weather.SNOWY, Weather.SUNNY, Weather.FOGGY, Weather.FOGGY, Weather.CLOUDY, Weather.SNOWY, Weather.CLOUDY]],
    [Season.AUTUMN, Biome.BARRENS, [Weather.RAINY, Weather.CLOUDY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.CLOUDY, Weather.STORMY, Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.CLOUDY, Weather.PARTLY_CLOUDY]],
    [Season.AUTUMN, Biome.CAVE, [Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED]],
    [Season.AUTUMN, Biome.COSMOS, [Weather.STARRY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.STARRY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY]],
    [Season.AUTUMN, Biome.DESERT, [Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SUNNY, Weather.CLOUDY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.SUNNY]],
    [Season.AUTUMN, Biome.FOREST, [Weather.RAINY, Weather.PARTLY_CLOUDY, Weather.FOGGY, Weather.RAINY, Weather.FOGGY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.CLOUDY, Weather.RAINY, Weather.PARTLY_CLOUDY, Weather.FOGGY, Weather.SUNNY]],
    [Season.AUTUMN, Biome.GRASSLAND, [Weather.FOGGY, Weather.RAINY, Weather.PARTLY_CLOUDY, Weather.CLOUDY, Weather.SUNNY, Weather.CLOUDY, Weather.STORMY, Weather.SUNNY, Weather.FOGGY, Weather.PARTLY_CLOUDY, Weather.FOGGY, Weather.SUNNY]],
    [Season.AUTUMN, Biome.LAVA_CAVE, [Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED]],
    [Season.AUTUMN, Biome.MOUNTAIN, [Weather.FOGGY, Weather.SNOWY, Weather.CLOUDY, Weather.SNOWY, Weather.PARTLY_CLOUDY, Weather.FOGGY, Weather.STORMY, Weather.SNOWY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.STORMY]],
    [Season.AUTUMN, Biome.SWAMP, [Weather.FOGGY, Weather.FOGGY, Weather.PARTLY_CLOUDY, Weather.CLOUDY, Weather.RAINY, Weather.FOGGY, Weather.STORMY, Weather.FOGGY, Weather.RAINY, Weather.RAINY, Weather.FOGGY, Weather.CLOUDY]],
    [Season.AUTUMN, Biome.TROPICAL, [Weather.RAINY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.STORMY, Weather.RAINY, Weather.PARTLY_CLOUDY, Weather.RAINY, Weather.STORMY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.STORMY]],
    [Season.AUTUMN, Biome.WILDERNESS, [Weather.PARTLY_CLOUDY, Weather.ASHFALL, Weather.SUNNY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.ASHFALL, Weather.ASHFALL, Weather.PARTLY_CLOUDY, Weather.ASHFALL, Weather.SUNNY, Weather.SUNNY, Weather.ASHFALL]],
    [Season.WINTER, Biome.ARCTIC, [Weather.SNOWY, Weather.SNOWY, Weather.CLOUDY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SNOWY, Weather.SNOWY, Weather.FOGGY, Weather.SNOWY, Weather.CLOUDY, Weather.SNOWY, Weather.FOGGY]],
    [Season.WINTER, Biome.BARRENS, [Weather.FOGGY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.CLOUDY, Weather.STORMY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.STORMY, Weather.CLOUDY, Weather.STORMY, Weather.SUNNY]],
    [Season.WINTER, Biome.CAVE, [Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED]],
    [Season.WINTER, Biome.COSMOS, [Weather.STARRY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.STARRY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY, Weather.SUNNY]],
    [Season.WINTER, Biome.DESERT, [Weather.FOGGY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.CLOUDY, Weather.SUNNY, Weather.SUNNY, Weather.FOGGY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.PARTLY_CLOUDY, Weather.PARTLY_CLOUDY, Weather.SUNNY]],
    [Season.WINTER, Biome.FOREST, [Weather.SNOWY, Weather.PARTLY_CLOUDY, Weather.FOGGY, Weather.SUNNY, Weather.CLOUDY, Weather.SNOWY, Weather.SNOWY, Weather.CLOUDY, Weather.FOGGY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SUNNY]],
    [Season.WINTER, Biome.GRASSLAND, [Weather.SNOWY, Weather.FOGGY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.FOGGY, Weather.SNOWY, Weather.SNOWY, Weather.PARTLY_CLOUDY, Weather.SUNNY, Weather.SNOWY, Weather.CLOUDY, Weather.PARTLY_CLOUDY]],
    [Season.WINTER, Biome.LAVA_CAVE, [Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED, Weather.COVERED]],
    [Season.WINTER, Biome.MOUNTAIN, [Weather.SNOWY, Weather.SNOWY, Weather.STORMY, Weather.SNOWY, Weather.CLOUDY, Weather.STORMY, Weather.SNOWY, Weather.FOGGY, Weather.SUNNY, Weather.STORMY, Weather.STORMY, Weather.CLOUDY]],
    [Season.WINTER, Biome.SWAMP, [Weather.SNOWY, Weather.FOGGY, Weather.RAINY, Weather.FOGGY, Weather.PARTLY_CLOUDY, Weather.SNOWY, Weather.SUNNY, Weather.FOGGY, Weather.SNOWY, Weather.RAINY, Weather.SNOWY, Weather.FOGGY]],
    [Season.WINTER, Biome.TROPICAL, [Weather.RAINY, Weather.CLOUDY, Weather.PARTLY_CLOUDY, Weather.RAINY, Weather.PARTLY_CLOUDY, Weather.RAINY, Weather.CLOUDY, Weather.STORMY, Weather.RAINY, Weather.PARTLY_CLOUDY, Weather.STORMY, Weather.RAINY]],
    [Season.WINTER, Biome.WILDERNESS, [Weather.STORMY, Weather.SUNNY, Weather.ASHFALL, Weather.ASHFALL, Weather.SUNNY, Weather.STORMY, Weather.ASHFALL, Weather.ASHFALL, Weather.SUNNY, Weather.STORMY, Weather.STORMY, Weather.ASHFALL]],
];

export function forecastFor(season: Season, biome: Biome): ReadonlyArray<Weather> | undefined {
    for (const [forecastSeason, forecastBiome, forecast] of WEATHER_FORECASTS) {
        if (forecastSeason === season && forecastBiome === biome) return forecast;
    }
    return undefined;
}
