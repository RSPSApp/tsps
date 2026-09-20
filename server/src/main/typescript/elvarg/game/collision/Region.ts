import { Location } from '../model/Location';

export class Region {
    private regionId: number;
    private terrainFile: number;
    private objectFile: number;
    public clips?: number[][][];
    public roofTiles?: Uint8Array;
    public waterTiles?: Uint8Array;
    public static readonly TILE_FLAG_UNDER_ROOF = 0x4;
    private loaded: boolean;

    constructor(regionId: number, terrainFile: number, objectFile: number) {
        this.regionId = regionId;
        this.terrainFile = terrainFile;
        this.objectFile = objectFile;
    }
    private static createClipGrid(): number[][][] {
        return Array.from({ length: 4 }, () =>
            Array.from({ length: 64 }, () => new Array(64).fill(0))
        );
    }
    public getRegionId(): number {
        return this.regionId;
    }

    public getTerrainFile(): number {
        return this.terrainFile;
    }

    public getObjectFile(): number {
        return this.objectFile;
    }

    public getClip(x: number, y: number, height: number): number {
        let regionAbsX = (this.regionId >> 8) * 64;
        let regionAbsY = (this.regionId & 0xff) * 64;
        if (height < 0 || height >= 4)
            height = 0;
        const clips = this.clips;
        if (!clips) {
            return 0;
        }
        if (!clips[height] || clips[height].length !== 64) {
            clips[height] = Array.from({ length: 64 }, () => new Array(64).fill(0));
        }
        if (!clips[height][x - regionAbsX]) {
            clips[height][x - regionAbsX] = new Array(64).fill(0);
        }
        return clips[height][x - regionAbsX][y - regionAbsY] || 0;
    }

    public addClip(x: number, y: number, height: number, shift: number): void {
        let regionAbsX = (this.regionId >> 8) * 64;
        let regionAbsY = (this.regionId & 0xff) * 64;
        if (height < 0 || height >= 4)
            height = 0;
        const clips = this.clips ??= Region.createClipGrid();
        if (!clips[height] || clips[height].length !== 64) {
            clips[height] = Array.from({ length: 64 }, () => new Array(64).fill(0));
        }
        if (!clips[height][x - regionAbsX]) {
            clips[height][x - regionAbsX] = new Array(64).fill(0);
        }
        clips[height][x - regionAbsX][y - regionAbsY] |= shift;
    }
    public removeClip(x: number, y: number, height: number, shift: number): void {
        let regionAbsX: number = (this.regionId >> 8) * 64;
        let regionAbsY: number = (this.regionId & 0xff) * 64;
        if (height < 0 || height >= 4)
            height = 0;
        const clips = this.clips;
        if (!clips) {
            return;
        }
        if (!clips[height] || clips[height].length !== 64) {
            clips[height] = Array.from({ length: 64 }, () => new Array(64).fill(0));
        }
        if (!clips[height][x - regionAbsX]) {
            clips[height][x - regionAbsX] = new Array(64).fill(0);
        }
        clips[height][x - regionAbsX][y - regionAbsY] &= ~shift;
    }

    public isUnderRoof(x: number, y: number, plane: number): boolean {
        if (!Number.isInteger(plane) || plane < 0 || plane > 3) return false;
        const index = (plane << 12) | ((x & 63) << 6) | (y & 63);
        return ((this.roofTiles?.[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
    }

    public isWater(x: number, y: number, plane: number): boolean {
        if (plane !== 0) return false;
        const index = ((x & 63) << 6) | (y & 63);
        return ((this.waterTiles?.[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
    }

    public getLocalPosition(position: Location): number[] {
        let absX: number = position.getX();
        let absY: number = position.getY();
        let regionAbsX: number = (this.regionId >> 8) * 64;
        let regionAbsY: number = (this.regionId & 0xff) * 64;
        let localX: number = absX - regionAbsX;
        let localY: number = absY - regionAbsY;
        return [localX, localY];
    }

    public isLoaded(): boolean {
        return this.loaded;
    }

    public setLoaded(loaded: boolean) {
        this.loaded = loaded;
    }

}
