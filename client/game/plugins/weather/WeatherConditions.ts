// Ported to TypeScript from ScreteMonge/3D-Weather (BSD-2-Clause).
// Condition art is part of the upstream plugin (BSD-2-Clause).
import BiomeArcticMini from "./assets/Biome - Arctic - Mini.png";
import BiomeArctic from "./assets/Biome - Arctic.png";
import BiomeBarrensMini from "./assets/Biome - Barrens - Mini.png";
import BiomeBarrens from "./assets/Biome - Barrens.png";
import BiomeCaveMini from "./assets/Biome - Cave - Mini.png";
import BiomeCave from "./assets/Biome - Cave.png";
import BiomeCosmosMini from "./assets/Biome - Cosmos - Mini.png";
import BiomeCosmos from "./assets/Biome - Cosmos.png";
import BiomeDesertMini from "./assets/Biome - Desert - Mini.png";
import BiomeDesert from "./assets/Biome - Desert.png";
import BiomeForestMini from "./assets/Biome - Forest - Mini.png";
import BiomeForest from "./assets/Biome - Forest.png";
import BiomeGrasslandMini from "./assets/Biome - Grassland - Mini.png";
import BiomeGrassland from "./assets/Biome - Grassland.png";
import BiomeLavaCaveMini from "./assets/Biome - Lava Cave - Mini.png";
import BiomeLavaCave from "./assets/Biome - Lava Cave.png";
import BiomeMountainMini from "./assets/Biome - Mountain - Mini.png";
import BiomeMountain from "./assets/Biome - Mountain.png";
import BiomeSwampMini from "./assets/Biome - Swamp - Mini.png";
import BiomeSwamp from "./assets/Biome - Swamp.png";
import BiomeTropicalMini from "./assets/Biome - Tropical - Mini.png";
import BiomeTropical from "./assets/Biome - Tropical.png";
import BiomeWildernessMini from "./assets/Biome - Wilderness - Mini.png";
import BiomeWilderness from "./assets/Biome - Wilderness.png";
import SeasonAutumnMini from "./assets/Season - Autumn - Mini.png";
import SeasonAutumn from "./assets/Season - Autumn.png";
import SeasonSpringMini from "./assets/Season - Spring - Mini.png";
import SeasonSpring from "./assets/Season - Spring.png";
import SeasonSummerMini from "./assets/Season - Summer - Mini.png";
import SeasonSummer from "./assets/Season - Summer.png";
import SeasonWinterMini from "./assets/Season - Winter - Mini.png";
import SeasonWinter from "./assets/Season - Winter.png";
import WeatherAshfallMini from "./assets/Weather - Ashfall - Mini.png";
import WeatherAshfall from "./assets/Weather - Ashfall.png";
import WeatherCloudyMini from "./assets/Weather - Cloudy - Mini.png";
import WeatherCloudy from "./assets/Weather - Cloudy.png";
import WeatherCosmosMini from "./assets/Weather - Cosmos - Mini.png";
import WeatherCosmos from "./assets/Weather - Cosmos.png";
import WeatherCoveredMini from "./assets/Weather - Covered - Mini.png";
import WeatherCovered from "./assets/Weather - Covered.png";
import WeatherFoggyMini from "./assets/Weather - Foggy - Mini.png";
import WeatherFoggy from "./assets/Weather - Foggy.png";
import WeatherPartlyCloudyMini from "./assets/Weather - Partly Cloudy - Mini.png";
import WeatherPartlyCloudy from "./assets/Weather - Partly Cloudy.png";
import WeatherRainingMini from "./assets/Weather - Raining - Mini.png";
import WeatherRaining from "./assets/Weather - Raining.png";
import WeatherSnowMini from "./assets/Weather - Snow - Mini.png";
import WeatherSnow from "./assets/Weather - Snow.png";
import WeatherStormyMini from "./assets/Weather - Stormy - Mini.png";
import WeatherStormy from "./assets/Weather - Stormy.png";
import WeatherSunnyMini from "./assets/Weather - Sunny - Mini.png";
import WeatherSunny from "./assets/Weather - Sunny.png";

export enum Weather {
    ASHFALL = "ASHFALL",
    CLOUDY = "CLOUDY",
    STARRY = "STARRY",
    COVERED = "COVERED",
    FOGGY = "FOGGY",
    PARTLY_CLOUDY = "PARTLY_CLOUDY",
    RAINY = "RAINY",
    SNOWY = "SNOWY",
    STORMY = "STORMY",
    SUNNY = "SUNNY",
}

export enum Biome {
    ARCTIC = "ARCTIC",
    BARRENS = "BARRENS",
    CAVE = "CAVE",
    COSMOS = "COSMOS",
    DESERT = "DESERT",
    FOREST = "FOREST",
    GRASSLAND = "GRASSLAND",
    LAVA_CAVE = "LAVA_CAVE",
    MOUNTAIN = "MOUNTAIN",
    SWAMP = "SWAMP",
    TROPICAL = "TROPICAL",
    WILDERNESS = "WILDERNESS",
}

export enum Season {
    SPRING = "SPRING",
    SUMMER = "SUMMER",
    AUTUMN = "AUTUMN",
    WINTER = "WINTER",
}

export enum SoundEffect {
    RAIN = "RAIN",
    THUNDERSTORM = "THUNDERSTORM",
    WIND = "WIND",
    RAIN_MUFFLED = "RAIN_MUFFLED",
    THUNDERSTORM_MUFFLED = "THUNDERSTORM_MUFFLED",
    WIND_MUFFLED = "WIND_MUFFLED",
}

// Upstream streams its ambience clips from GitHub; the URLs are part of the plugin.
export const SOUND_EFFECT_URLS: Record<SoundEffect, string> = {
    [SoundEffect.RAIN]: "https://github.com/ScreteMonge/WeatherAmbience/raw/main/617078__mikaelacampbell18__rain-forest-steady_edited.mp3",
    [SoundEffect.THUNDERSTORM]: "https://github.com/ScreteMonge/WeatherAmbience/raw/main/180327__aeonemi__lighting-strike-and-thunder_edited.mp3",
    [SoundEffect.WIND]: "https://github.com/ScreteMonge/WeatherAmbience/raw/main/201208__rivv3t__raw-wind_edited.mp3",
    [SoundEffect.RAIN_MUFFLED]: "https://github.com/ScreteMonge/WeatherAmbience/raw/main/617078__mikaelacampbell18__rain-forest-steady_edited_MUFFLED.mp3",
    [SoundEffect.THUNDERSTORM_MUFFLED]: "https://github.com/ScreteMonge/WeatherAmbience/raw/main/180327__aeonemi__lighting-strike-and-thunder_edited_MUFFLED.mp3",
    [SoundEffect.WIND_MUFFLED]: "https://github.com/ScreteMonge/WeatherAmbience/raw/main/201208__rivv3t__raw-wind_edited_MUFFLED.mp3",
};

export interface ConditionInfo {
    name: string;
    image: string;
    miniImage: string;
}

export interface WeatherInfo extends ConditionInfo {
    hasPrecipitation: boolean;
    modelVariety: number;
    hasSound: boolean;
    soundEffect?: SoundEffect;
    maxObjects: number;
    maxObjectVolume: number;
    changeRate: number;
}

export const WEATHER_INFO: Record<Weather, WeatherInfo> = {
    [Weather.ASHFALL]: {
        name: "Ashfall",
        image: WeatherAshfall,
        miniImage: WeatherAshfallMini,
        hasPrecipitation: true,
        modelVariety: 3,
        hasSound: false,
        maxObjects: 1200,
        maxObjectVolume: 800,
        changeRate: 4,
    },
    [Weather.CLOUDY]: {
        name: "Cloudy",
        image: WeatherCloudy,
        miniImage: WeatherCloudyMini,
        hasPrecipitation: true,
        modelVariety: 3,
        hasSound: false,
        maxObjects: 1000,
        maxObjectVolume: 600,
        changeRate: 200,
    },
    [Weather.STARRY]: {
        name: "Otherworldly",
        image: WeatherCosmos,
        miniImage: WeatherCosmosMini,
        hasPrecipitation: true,
        modelVariety: 3,
        hasSound: false,
        maxObjects: 2000,
        maxObjectVolume: 1000,
        changeRate: 8,
    },
    [Weather.COVERED]: {
        name: "Sheltered",
        image: WeatherCovered,
        miniImage: WeatherCoveredMini,
        hasPrecipitation: false,
        modelVariety: 1,
        hasSound: false,
        maxObjects: 0,
        maxObjectVolume: 0,
        changeRate: 1,
    },
    [Weather.FOGGY]: {
        name: "Foggy",
        image: WeatherFoggy,
        miniImage: WeatherFoggyMini,
        hasPrecipitation: true,
        modelVariety: 3,
        hasSound: false,
        maxObjects: 1800,
        maxObjectVolume: 1100,
        changeRate: 200,
    },
    [Weather.PARTLY_CLOUDY]: {
        name: "Partly Cloudy",
        image: WeatherPartlyCloudy,
        miniImage: WeatherPartlyCloudyMini,
        hasPrecipitation: true,
        modelVariety: 3,
        hasSound: false,
        maxObjects: 300,
        maxObjectVolume: 200,
        changeRate: 200,
    },
    [Weather.RAINY]: {
        name: "Raining",
        image: WeatherRaining,
        miniImage: WeatherRainingMini,
        hasPrecipitation: true,
        modelVariety: 3,
        hasSound: true,
        soundEffect: SoundEffect.RAIN,
        maxObjects: 2000,
        maxObjectVolume: 1200,
        changeRate: 2,
    },
    [Weather.SNOWY]: {
        name: "Snowing",
        image: WeatherSnow,
        miniImage: WeatherSnowMini,
        hasPrecipitation: true,
        modelVariety: 3,
        hasSound: true,
        soundEffect: SoundEffect.WIND,
        maxObjects: 1800,
        maxObjectVolume: 1200,
        changeRate: 4,
    },
    [Weather.STORMY]: {
        name: "Stormy",
        image: WeatherStormy,
        miniImage: WeatherStormyMini,
        hasPrecipitation: true,
        modelVariety: 3,
        hasSound: true,
        soundEffect: SoundEffect.THUNDERSTORM,
        maxObjects: 3000,
        maxObjectVolume: 1400,
        changeRate: 1,
    },
    [Weather.SUNNY]: {
        name: "Clear",
        image: WeatherSunny,
        miniImage: WeatherSunnyMini,
        hasPrecipitation: false,
        modelVariety: 1,
        hasSound: false,
        maxObjects: 0,
        maxObjectVolume: 0,
        changeRate: 1,
    },
};

const BIOME_NAMES: Record<Biome, string> = {
    [Biome.ARCTIC]: "Arctic",
    [Biome.BARRENS]: "Barrens",
    [Biome.CAVE]: "Caves",
    [Biome.COSMOS]: "Cosmos",
    [Biome.DESERT]: "Desert",
    [Biome.FOREST]: "Woodland",
    [Biome.GRASSLAND]: "Grassland",
    [Biome.LAVA_CAVE]: "Lava Caves",
    [Biome.MOUNTAIN]: "Mountains",
    [Biome.SWAMP]: "Swamp",
    [Biome.TROPICAL]: "Tropics",
    [Biome.WILDERNESS]: "Wilderness",
};

const BIOME_IMAGES: Record<Biome, string> = {
    [Biome.ARCTIC]: BiomeArctic,
    [Biome.BARRENS]: BiomeBarrens,
    [Biome.CAVE]: BiomeCave,
    [Biome.COSMOS]: BiomeCosmos,
    [Biome.DESERT]: BiomeDesert,
    [Biome.FOREST]: BiomeForest,
    [Biome.GRASSLAND]: BiomeGrassland,
    [Biome.LAVA_CAVE]: BiomeLavaCave,
    [Biome.MOUNTAIN]: BiomeMountain,
    [Biome.SWAMP]: BiomeSwamp,
    [Biome.TROPICAL]: BiomeTropical,
    [Biome.WILDERNESS]: BiomeWilderness,
};

const BIOME_MINI_IMAGES: Record<Biome, string> = {
    [Biome.ARCTIC]: BiomeArcticMini,
    [Biome.BARRENS]: BiomeBarrensMini,
    [Biome.CAVE]: BiomeCaveMini,
    [Biome.COSMOS]: BiomeCosmosMini,
    [Biome.DESERT]: BiomeDesertMini,
    [Biome.FOREST]: BiomeForestMini,
    [Biome.GRASSLAND]: BiomeGrasslandMini,
    [Biome.LAVA_CAVE]: BiomeLavaCaveMini,
    [Biome.MOUNTAIN]: BiomeMountainMini,
    [Biome.SWAMP]: BiomeSwampMini,
    [Biome.TROPICAL]: BiomeTropicalMini,
    [Biome.WILDERNESS]: BiomeWildernessMini,
};

export const BIOME_INFO: Record<Biome, ConditionInfo> = Object.fromEntries(
    (Object.keys(BIOME_NAMES) as Biome[]).map((biome) => [
        biome,
        { name: BIOME_NAMES[biome], image: BIOME_IMAGES[biome], miniImage: BIOME_MINI_IMAGES[biome] },
    ]),
) as Record<Biome, ConditionInfo>;

const SEASON_NAMES: Record<Season, string> = {
    [Season.SPRING]: "Spring",
    [Season.SUMMER]: "Summer",
    [Season.AUTUMN]: "Autumn",
    [Season.WINTER]: "Winter",
};

const SEASON_IMAGES: Record<Season, string> = {
    [Season.SPRING]: SeasonSpring,
    [Season.SUMMER]: SeasonSummer,
    [Season.AUTUMN]: SeasonAutumn,
    [Season.WINTER]: SeasonWinter,
};

const SEASON_MINI_IMAGES: Record<Season, string> = {
    [Season.SPRING]: SeasonSpringMini,
    [Season.SUMMER]: SeasonSummerMini,
    [Season.AUTUMN]: SeasonAutumnMini,
    [Season.WINTER]: SeasonWinterMini,
};

export const SEASON_INFO: Record<Season, ConditionInfo> = Object.fromEntries(
    (Object.keys(SEASON_NAMES) as Season[]).map((season) => [
        season,
        { name: SEASON_NAMES[season], image: SEASON_IMAGES[season], miniImage: SEASON_MINI_IMAGES[season] },
    ]),
) as Record<Season, ConditionInfo>;

