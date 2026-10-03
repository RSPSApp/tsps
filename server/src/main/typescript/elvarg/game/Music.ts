import * as fs from "fs";
import * as path from "path";

type MusicData = {
    regions: Record<number, number[]>;
};

const MUSIC_DATA: MusicData = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.resolve("data/definitions/music-data.json"), "utf8"));
    } catch (error) {
        console.warn("[music] failed to load region music", error);
        return { regions: {} };
    }
})();

export class Music {
    public static forRegion(regionId: number): number | undefined {
        return MUSIC_DATA.regions[regionId]?.[0];
    }
}
