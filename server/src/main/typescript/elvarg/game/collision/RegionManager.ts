import { ObjectDefinition } from '../definition/ObjectDefinition'
import type { Mobile } from '../entity/impl/Mobile'
import { GameObject } from '../entity/impl/object/GameObject'
import { MapObjects } from '../entity/impl/object/MapObjects'
import { Direction } from '../model/Direction'
import { Location } from '../model/Location'
import { PrivateArea } from '../model/areas/impl/PrivateArea'
import { Buffer } from './Buffer'
import { Region } from './Region'
import * as fs from "fs";
import * as path from "path";
import { PluginManager } from "../../plugins/PluginManager";
import { MapRegionReplacementManager } from "./MapRegionReplacementManager";
import { CacheMaps } from "../cache/CacheMaps";
import { CachePipeline } from "../cache/CachePipeline";
import { isWaterOverlayId } from "../cache/TerrainWater";

export class RegionManager {
    public static PROJECTILE_NORTH_WEST_BLOCKED = 0x200;
    public static PROJECTILE_NORTH_BLOCKED = 0x400;
    public static PROJECTILE_NORTH_EAST_BLOCKED = 0x800;
    public static PROJECTILE_EAST_BLOCKED = 0x1000;
    public static PROJECTILE_SOUTH_EAST_BLOCKED = 0x2000;
    public static PROJECTILE_SOUTH_BLOCKED = 0x4000;
    public static PROJECTILE_SOUTH_WEST_BLOCKED = 0x8000;
    public static PROJECTILE_WEST_BLOCKED = 0x10000;
    public static PROJECTILE_TILE_BLOCKED = 0x20000;
    public static UNKNOWN = 0x80000;
    public static BLOCKED_TILE = 0x200000;
    public static UNLOADED_TILE = 0x1000000;
    public static OCEAN_TILE = 2097152;

    public static regions: Map<number, Region> = new Map<number, Region>();
    private static loadingRegions: Set<number> = new Set<number>();

    public static init(): void {
        ObjectDefinition.init();
        RegionManager.regions.clear();
        for (const regionId of CacheMaps.getRegionIds()) {
            const files = CacheMaps.getArchiveIds(regionId)!;
            RegionManager.regions.set(regionId, new Region(regionId, files.terrainFile, files.objectFile));
        }
        const replacementDir = path.resolve(process.cwd(), "data", "regions");
        if (fs.existsSync(replacementDir)) {
            for (const name of fs.readdirSync(replacementDir).sort()) {
                const match = /^(\d+)\.pack$/.exec(name);
                if (!match) continue;
                const packPath = path.join(replacementDir, name);
                try {
                    MapRegionReplacementManager.replaceMapRegion(Number(match[1]), packPath);
                } catch (err) {
                    console.warn(
                        `[collision] skipping region replacement pack (falling back to cache region): ${packPath}`,
                        (err as Error)?.message ?? err
                    );
                }
            }
        }
        console.info(`[collision] indexed ${RegionManager.regions.size} cache regions`);
    }

    public static getRegionid(regionId: number): Region | undefined {
        return this.regions.get(regionId);
    }

    public static regionIdForTile(x: number, y: number): number {
        return ((x >> 6) << 8) + (y >> 6);
    }

    public static getRegion(x: number, y: number): Region | undefined {
        const regionId = RegionManager.regionIdForTile(x, y);
        if (RegionManager.loadingRegions.size === 0) {
            RegionManager.loadMapFiles(x, y);
        }
        return RegionManager.getRegionid(regionId);
    }

    public static isWater(position: Location): boolean {
        return RegionManager.getRegion(position.getX(), position.getY())
            ?.isWater(position.getX(), position.getY(), position.getZ()) === true;
    }
    private static addClippingForVariableObject(x: number, y: number, height: number, type: number, direction: number, tall: boolean, privateArea: PrivateArea) {
        if (type == 0) {
            if (direction == 0) {
                this.addClipping(x, y, height, 128, privateArea);
                this.addClipping(x - 1, y, height, 8, privateArea);
            } else if (direction == 1) {
                this.addClipping(x, y, height, 2, privateArea);
                this.addClipping(x, y + 1, height, 32, privateArea);
            } else if (direction == 2) {
                this.addClipping(x, y, height, 8, privateArea);
                this.addClipping(x + 1, y, height, 128, privateArea);
            } else if (direction == 3) {
                this.addClipping(x, y, height, 32, privateArea);
                this.addClipping(x, y - 1, height, 2, privateArea);
            }
        } else if (type == 1 || type == 3) {
            if (direction == 0) {
                this.addClipping(x, y, height, 1, privateArea);
                this.addClipping(x - 1, y + 1, height, 16, privateArea);
            } else if (direction == 1) {
                this.addClipping(x, y, height, 4, privateArea);
                this.addClipping(x + 1, y + 1, height, 64, privateArea);
            } else if (direction == 2) {
                this.addClipping(x, y, height, 16, privateArea);
                this.addClipping(x + 1, y - 1, height, 1, privateArea);
            } else if (direction == 3) {
                this.addClipping(x, y, height, 64, privateArea);
                this.addClipping(x - 1, y - 1, height, 4, privateArea);
            }
        } else if (type == 2) {
            if (direction == 0) {
                this.addClipping(x, y, height, 130, privateArea);
                this.addClipping(x - 1, y, height, 8, privateArea);
                this.addClipping(x, y + 1, height, 32, privateArea);
            } else if (direction == 1) {
                this.addClipping(x, y, height, 10, privateArea);
                this.addClipping(x, y + 1, height, 32, privateArea);
                this.addClipping(x + 1, y, height, 128, privateArea);
            } else if (direction == 2) {
                this.addClipping(x, y, height, 40, privateArea);
                this.addClipping(x + 1, y, height, 128, privateArea);
                this.addClipping(x, y - 1, height, 2, privateArea);
            } else if (direction == 3) {
                this.addClipping(x, y, height, 160, privateArea);
                this.addClipping(x, y - 1, height, 2, privateArea);
                this.addClipping(x - 1, y, height, 8, privateArea);
            }
        }
        if (tall) {
            // If an object is tall, it blocks projectiles too
            if (type == 0) {
                if (direction == 0) {
                    this.addClipping(x, y, height, 65536, privateArea);
                    this.addClipping(x - 1, y, height, 4096, privateArea);
                } else if (direction == 1) {
                    this.addClipping(x, y, height, 1024, privateArea);
                    this.addClipping(x, y + 1, height, 16384, privateArea);
                } else if (direction == 2) {
                    this.addClipping(x, y, height, 4096, privateArea);
                    this.addClipping(x + 1, y, height, 65536, privateArea);
                } else if (direction == 3) {
                    this.addClipping(x, y, height, 16384, privateArea);
                    this.addClipping(x, y - 1, height, 1024, privateArea);
                }
            } else if (type == 1 || type == 3) {
                if (direction == 0) {
                    this.addClipping(x, y, height, 512, privateArea);
                    this.addClipping(x - 1, y + 1, height, 8192, privateArea);
                } else if (direction == 1) {
                    this.addClipping(x, y, height, 2048, privateArea);
                    this.addClipping(x + 1, y + 1, height, 32768, privateArea);
                } else if (direction == 2) {
                    this.addClipping(x, y, height, 8192, privateArea);
                    this.addClipping(x + 1, y - 1, height, 512, privateArea);
                } else if (direction == 3) {
                    this.addClipping(x, y, height, 32768, privateArea);
                    this.addClipping(x - 1, y - 1, height, 2048, privateArea);
                }
            } else if (type == 2) {
                if (direction == 0) {
                    this.addClipping(x, y, height, 66560, privateArea);
                    this.addClipping(x - 1, y, height, 4096, privateArea);
                    this.addClipping(x, y + 1, height, 16384, privateArea);
                } else if (direction == 1) {
                    this.addClipping(x, y, height, 5120, privateArea);
                    this.addClipping(x, y + 1, height, 16384, privateArea);
                    this.addClipping(x + 1, y, height, 65536, privateArea);
                } else if (direction == 2) {
                    this.addClipping(x, y, height, 20480, privateArea);
                    this.addClipping(x + 1, y, height, 65536, privateArea);
                    this.addClipping(x, y - 1, height, 1024, privateArea);
                } else if (direction == 3) {
                    this.addClipping(x, y, height, 81920, privateArea);
                    this.addClipping(x, y - 1, height, 1024, privateArea);
                    this.addClipping(x - 1, y, height, 4096, privateArea);
                }
            }
        }
    }
    public static removeClippingForVariableObject(x: number, y: number, height: number, type: number, direction: number, tall: boolean, privateArea: PrivateArea) {
        if (type == 0) {
            if (direction == 0) {
                RegionManager.removeClipping(x, y, height, 128, privateArea);
                RegionManager.removeClipping(x - 1, y, height, 8, privateArea);
            } else if (direction == 1) {
                RegionManager.removeClipping(x, y, height, 2, privateArea);
                RegionManager.removeClipping(x, y + 1, height, 32, privateArea);
            } else if (direction == 2) {
                RegionManager.removeClipping(x, y, height, 8, privateArea);
                RegionManager.removeClipping(x + 1, y, height, 128, privateArea);
            } else if (direction == 3) {
                RegionManager.removeClipping(x, y, height, 32, privateArea);
                RegionManager.removeClipping(x, y - 1, height, 2, privateArea);
            }
        } else if (type == 1 || type == 3) {
            if (direction == 0) {
                RegionManager.removeClipping(x, y, height, 1, privateArea);
                RegionManager.removeClipping(x - 1, y + 1, height, 16, privateArea);
            } else if (direction == 1) {
                RegionManager.removeClipping(x, y, height, 4, privateArea);
                RegionManager.removeClipping(x + 1, y + 1, height, 64, privateArea);
            } else if (direction == 2) {
                RegionManager.removeClipping(x, y, height, 16, privateArea);
                RegionManager.removeClipping(x + 1, y - 1, height, 1, privateArea);
            } else if (direction == 3) {
                RegionManager.removeClipping(x, y, height, 64, privateArea);
                RegionManager.removeClipping(x - 1, y - 1, height, 4, privateArea);
            }
        } else if (type == 2) {
            if (direction == 0) {
                RegionManager.removeClipping(x, y, height, 130, privateArea);
                RegionManager.removeClipping(x - 1, y, height, 8, privateArea);
                RegionManager.removeClipping(x, y + 1, height, 32, privateArea);
            } else if (direction == 1) {
                RegionManager.removeClipping(x, y, height, 10, privateArea);
                RegionManager.removeClipping(x, y + 1, height, 32, privateArea);
                RegionManager.removeClipping(x + 1, y, height, 128, privateArea);
            } else if (direction == 2) {
                RegionManager.removeClipping(x, y, height, 40, privateArea);
                RegionManager.removeClipping(x + 1, y, height, 128, privateArea);
                RegionManager.removeClipping(x, y - 1, height, 2, privateArea);
            } else if (direction == 3) {
                RegionManager.removeClipping(x, y, height, 160, privateArea);
                RegionManager.removeClipping(x, y - 1, height, 2, privateArea);
                RegionManager.removeClipping(x - 1, y, height, 8, privateArea);
            }
        }

        if (tall) {
            // If an object is tall, it blocks projectiles too
            if (type === 0) {
                if (direction === 0) {
                    RegionManager.removeClipping(x, y, height, 65536, privateArea);
                    RegionManager.removeClipping(x - 1, y, height, 4096, privateArea);
                } else if (direction === 1) {
                    RegionManager.removeClipping(x, y, height, 1024, privateArea);
                    RegionManager.removeClipping(x, y + 1, height, 16384, privateArea);
                } else if (direction === 2) {
                    RegionManager.removeClipping(x, y, height, 4096, privateArea);
                    RegionManager.removeClipping(x + 1, y, height, 65536, privateArea);
                } else if (direction === 3) {
                    RegionManager.removeClipping(x, y, height, 16384, privateArea);
                    RegionManager.removeClipping(x, y - 1, height, 1024, privateArea);
                }
            }
        }
        if (type == 1 || type == 3) {
            if (direction == 0) {
                RegionManager.removeClipping(x, y, height, 512, privateArea);
                RegionManager.removeClipping(x - 1, y + 1, height, 8192, privateArea);
            } else if (direction == 1) {
                RegionManager.removeClipping(x, y, height, 2048, privateArea);
                RegionManager.removeClipping(x + 1, y + 1, height, 32768, privateArea);
            } else if (direction == 2) {
                RegionManager.removeClipping(x, y, height, 8192, privateArea);
                RegionManager.removeClipping(x + 1, y - 1, height, 512, privateArea);
            } else if (direction == 3) {
                RegionManager.removeClipping(x, y, height, 32768, privateArea);
                RegionManager.removeClipping(x - 1, y - 1, height, 2048, privateArea);
            }
        } else if (type == 2) {
            if (direction == 0) {
                RegionManager.removeClipping(x, y, height, 66560, privateArea);
                RegionManager.removeClipping(x - 1, y, height, 4096, privateArea);
                RegionManager.removeClipping(x, y + 1, height, 16384, privateArea);
            } else if (direction == 1) {
                RegionManager.removeClipping(x, y, height, 5120, privateArea);
                RegionManager.removeClipping(x, y + 1, height, 16384, privateArea);
                RegionManager.removeClipping(x + 1, y, height, 65536, privateArea);
            } else if (direction == 2) {
                RegionManager.removeClipping(x, y, height, 20480, privateArea);
                RegionManager.removeClipping(x + 1, y, height, 65536, privateArea);
                RegionManager.removeClipping(x, y - 1, height, 1024, privateArea);
            } else if (direction == 3) {
                RegionManager.removeClipping(x, y, height, 81920, privateArea);
                RegionManager.removeClipping(x, y - 1, height, 1024, privateArea);
                RegionManager.removeClipping(x - 1, y, height, 4096, privateArea);
            }
        }
    }
    private static addClippingForSolidObject(x: number, y: number, height: number, xLength: number, yLength: number, flag: boolean, privateArea: PrivateArea): void {
        let clipping: number = 256;
        if (flag) {
            clipping += 0x20000;
        }
        for (let i = x; i < x + xLength; i++) {
            for (let i2 = y; i2 < y + yLength; i2++) {
                this.addClipping(i, i2, height, clipping, privateArea);
            }
        }
    }

    private static removeClippingForSolidObject(x: number, y: number, height: number, xLength: number, yLength: number, flag: boolean, privateArea: PrivateArea): void {
        let clipping: number = 256;
        if (flag) {
            clipping += 0x20000;
        }

        for (let x_ = x; x_ < x + xLength; x_++) {
            for (let y_ = y; y_ < y + yLength; y_++) {
                this.removeClipping(x_, y_, height, clipping, privateArea);
            }
        }
    }

    public static addObject(objectId: number, x: number, y: number, height: number, type: number, direction: number) {
        const position = new Location(x, y, height);

        if (objectId === -1) {
            MapObjects.clear(position, type);
        } else {
            MapObjects.add(new GameObject(objectId, position, type, direction, null));
        }
    }
    public static addObjectClipping(object: GameObject) {
        const id = object.getId();
        const x = object.getLocation().getX();
        const y = object.getLocation().getY();
        const height = object.getLocation().getZ();
        const type = object.getType();
        const direction = object.getFace();

        if (id === -1) {
            this.removeClipping(x, y, height, 0x000000, object.getPrivateArea());
            return;
        }

        const def: ObjectDefinition = object.getDefinition();
        if (!def) {
            return;
        }

        let xLength: number;
        let yLength: number;
        if (direction !== 1 && direction !== 3) {
            xLength = def.getSizeX();
            yLength = def.getSizeY();
        } else {
            yLength = def.getSizeX();
            xLength = def.getSizeY();
        }

        if (type === 22) {
            if (def.isClippedDecoration()) {
                RegionManager.addClipping(x, y, height, 0x40000, object.getPrivateArea());
            }
        } else if (type >= 9 && type <= 11) {
            if (def.isSolid()) {
                RegionManager.addClippingForSolidObject(x, y, height, xLength, yLength, def.isImpenetrable(), object.getPrivateArea());
            }
        } else if (type >= 0 && type <= 3) {
            if (def.isSolid()) {
                RegionManager.addClippingForVariableObject(x, y, height, type, direction, def.isImpenetrable(), object.getPrivateArea());
            }
        }
    }
    public static removeObjectClipping(object: GameObject) {
        const x = object.getLocation().getX();
        const y = object.getLocation().getY();
        const height = object.getLocation().getZ();
        const type = object.getType();
        const direction = object.getFace();

        if (object.getId() === -1) {
            this.removeClipping(x, y, height, 0x000000, object.getPrivateArea());
            return;
        }

        const def = object.getDefinition();
        if (!def) {
            return;
        }
        let xLength: number;
        let yLength: number;
        if (direction !== 1 && direction !== 3) {
            xLength = def.getSizeX();
            yLength = def.getSizeY();
        } else {
            yLength = def.getSizeX();
            xLength = def.getSizeY();
        }

        if (type === 22) {
            if (def.isClippedDecoration()) {
                this.removeClipping(x, y, height, 0x40000, object.getPrivateArea());
            }
        } else if (type >= 9 && type <= 11) {
            if (def.isSolid()) {
                this.removeClippingForSolidObject(x, y, height, xLength, yLength, def.isSolid(), object.getPrivateArea());
            }
        } else if (type >= 0 && type <= 3) {
            if (def.isSolid()) {
                RegionManager.removeClippingForVariableObject(x, y, height, type, direction, def.isSolid(), object.getPrivateArea());
            }
        }
    }

    private static applyPrivateClipping(privateArea: PrivateArea | null, fn: (clipArea: PrivateArea) => void) {
        if (!privateArea) {
            return false;
        }
        if (typeof privateArea.getClip !== "function") {
            return false;
        }
        fn(privateArea);
        return true;
    }

    public static addClipping(x: number, y: number, height: number, shift: number, privateArea: PrivateArea | null, region?: Region) {
        if (RegionManager.applyPrivateClipping(privateArea, (area) => {
            const location = new Location(x, y, height);
            const current = area.hasClip(location)
                ? area.getClip(location)
                : (region ?? RegionManager.getRegion(x, y))?.getClip(x, y, height) ?? 0;
            area.setClip(location, current | shift);
        })) {
            return;
        }
        const r = region ?? RegionManager.getRegion(x, y);
        if (r) {
            r.addClip(x, y, height, shift);
        }
    }

    public static removeClipping(x: number, y: number, height: number, shift: number, privateArea: PrivateArea) {
        if (RegionManager.applyPrivateClipping(privateArea, (area) => {
            const location = new Location(x, y, height);
            const current = area.hasClip(location)
                ? area.getClip(location)
                : RegionManager.getRegion(x, y)?.getClip(x, y, height) ?? 0;
            area.setClip(location, current & ~shift);
        })) {
            return;
        }
        const r = RegionManager.getRegion(x, y);
        if (r) {
            r.removeClip(x, y, height, shift);
        }
    }

    public static getClipping(x: number, y: number, height: number, privateArea: PrivateArea | null) {
        if (
            privateArea &&
            typeof privateArea.getClip === "function" &&
            privateArea.hasClip(new Location(x, y, height))
        ) {
            return privateArea.getClip(new Location(x, y, height));
        }


        const r = RegionManager.getRegion(x, y);
        if (r) {
            return r.getClip(x, y, height);
        }
        return 0;
    }

    public static wallExists(location: Location, area: PrivateArea, type: number) {
        const object = MapObjects.get(type, location, area);
        if (object) {
            const objectDef = object.getDefinition();
            if (!objectDef.name || objectDef.name === "null") {
                return true;
            }
        }
        return false;
    }

    public static wallsExist(location: Location, area: PrivateArea) {
        if (RegionManager.wallExists(location, area, 0)) {
            return true;
        }
        if (RegionManager.wallExists(location, area, 1)) {
            return true;
        }
        if (RegionManager.wallExists(location, area, 2)) {
            return true;
        }
        if (RegionManager.wallExists(location, area, 3)) {
            return true;
        }
        if (RegionManager.wallExists(location, area, 9)) {
            return true;
        }
        return false;
    }



    public static canMoveIsBlocked(pos: Location, direction: number, privateArea: PrivateArea) {
        if (direction === 0) {
            return !RegionManager.blockedNorthWest(pos, privateArea) && !RegionManager.blockedNorth(pos, privateArea) && !RegionManager.blockedWest(pos, privateArea);
        } else if (direction === 1) {
            return !RegionManager.blockedNorth(pos, privateArea);
        } else if (direction === 2) {
            return !RegionManager.blockedNorthEast(pos, privateArea) && !RegionManager.blockedNorth(pos, privateArea) && !RegionManager.blockedEast(pos, privateArea);
        } else if (direction === 3) {
            return !RegionManager.blockedWest(pos, privateArea);
        } else if (direction === 4) {
            return !RegionManager.blockedEast(pos, privateArea);
        } else if (direction === 5) {
            return !RegionManager.blockedSouthWest(pos, privateArea) && !RegionManager.blockedSouth(pos, privateArea) && !RegionManager.blockedWest(pos, privateArea);
        } else if (direction === 6) {
            return !RegionManager.blockedSouth(pos, privateArea);
        } else if (direction === 7) {
            return !RegionManager.blockedSouthEast(pos, privateArea) && !RegionManager.blockedSouth(pos, privateArea) && !RegionManager.blockedEast(pos, privateArea);
        }
        return false;
    }

    public static blockedProjectile(position: Location, privateArea: PrivateArea) {
        return (RegionManager.getClipping(position.getX(), position.getY(), position.getZ(), privateArea) & 0x20000) === 0;
    }

    public static blocked(pos: Location, privateArea: PrivateArea) {
        return (RegionManager.getClipping(pos.getX(), pos.getY(), pos.getZ(), privateArea) & 0x1280120) !== 0;
    }

    public static blockedNorth(pos: Location, privateArea: PrivateArea) {
        return (RegionManager.getClipping(pos.getX(), pos.getY() + 1, pos.getZ(), privateArea) & 0x1280120) !== 0;
    }

    public static blockedEast(pos: Location, privateArea: PrivateArea) {
        return (RegionManager.getClipping(pos.getX() + 1, pos.getY(), pos.getZ(), privateArea) & 0x1280180) !== 0;
    }

    public static blockedSouth(pos: Location, privateArea: PrivateArea) {
        return (RegionManager.getClipping(pos.getX(), pos.getY() - 1, pos.getZ(), privateArea) & 0x1280102) !== 0;
    }

    public static blockedWest(pos: Location, privateArea: PrivateArea): boolean {
        return (RegionManager.getClipping(pos.getX() - 1, pos.getY(), pos.getZ(), privateArea) & 0x1280108) != 0;
    }

    public static blockedNorthEast(pos: Location, privateArea: PrivateArea): boolean {
        return (RegionManager.getClipping(pos.getX() + 1, pos.getY() + 1, pos.getZ(), privateArea) & 0x12801e0) != 0;
    }

    public static blockedNorthWest(pos: Location, privateArea: PrivateArea): boolean {
        return (RegionManager.getClipping(pos.getX() - 1, pos.getY() + 1, pos.getZ(), privateArea) & 0x1280138) != 0;
    }

    public static blockedSouthEast(pos: Location, privateArea: PrivateArea): boolean {
        return (RegionManager.getClipping(pos.getX() + 1, pos.getY() - 1, pos.getZ(), privateArea) & 0x1280183) != 0;
    }

    public static blockedSouthWest(pos: Location, privateArea: PrivateArea): boolean {
        return (RegionManager.getClipping(pos.getX() - 1, pos.getY() - 1, pos.getZ(), privateArea) & 0x128010e) != 0;
    }
    public static canProjectileAttack(attacker: Mobile, from: Location, to: Location): boolean {
        let a = from;
        let b = to;
        if (a.getX() > b.getX()) {
            a = to;
            b = from;
        }
        return RegionManager.canProjectileMove(
            a.getX(),
            a.getY(),
            b.getX(),
            b.getY(),
            a.getZ(),
            attacker.getSize(),
            attacker.getSize(),
            attacker.getPrivateArea()
        );
    }
    public static canProjectileAttackTarget(attacker: Mobile, target: Mobile): boolean {
        let a = attacker.getLocation();
        let b = target.getLocation();

        if (attacker.isPlayer() && target.isPlayer()) {
            if (a.getX() > b.getX()) {
                a = target.getLocation();
                b = attacker.getLocation();
            }
        } else if (target.isPlayer()) {
            a = target.getLocation();
            b = attacker.getLocation();
        }
        return RegionManager.canProjectileAttack(attacker, a, b);
    }

    public static canProjectileAttackReturn(a: Location, b: Location, size: number, area: PrivateArea): boolean {
        return RegionManager.canProjectileMove(a.getX(), a.getY(), b.getX(), b.getY(), a.getZ(), size, size, area);
    }

    public static canProjectileAttackBounds(
        source: Location,
        destination: Location,
        sourceWidth: number,
        sourceLength: number,
        destinationWidth: number,
        destinationLength: number,
        area: PrivateArea
    ): boolean {
        const coordinate = (origin: number, other: number, size: number) =>
            origin >= other ? origin : origin + size - 1 <= other ? origin + size - 1 : other;
        const startX = coordinate(source.getX(), destination.getX(), Math.max(1, sourceWidth));
        const startY = coordinate(source.getY(), destination.getY(), Math.max(1, sourceLength));
        const endX = coordinate(destination.getX(), source.getX(), Math.max(1, destinationWidth));
        const endY = coordinate(destination.getY(), source.getY(), Math.max(1, destinationLength));
        return RegionManager.canProjectileRay(startX, startY, endX, endY, source.getZ(), area);
    }

    public static canProjectileMove(startX: number, startY: number, endX: number, endY: number, height: number, xLength: number, yLength: number, privateArea: PrivateArea) {
        const coordinate = (origin: number, other: number, size: number) =>
            origin >= other ? origin : origin + size - 1 <= other ? origin + size - 1 : other;
        return RegionManager.canProjectileRay(
            coordinate(startX, endX, Math.max(1, xLength)),
            coordinate(startY, endY, Math.max(1, yLength)),
            endX,
            endY,
            height,
            privateArea
        );
    }

    private static canProjectileRay(
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        height: number,
        privateArea: PrivateArea
    ): boolean {
        if (startX === endX && startY === endY) return true;
        const deltaX = endX - startX;
        const deltaY = endY - startY;
        const east = deltaX >= 0;
        const north = deltaY >= 0;
        let xFlags = RegionManager.UNLOADED_TILE | RegionManager.UNKNOWN |
            RegionManager.PROJECTILE_TILE_BLOCKED |
            (east ? RegionManager.PROJECTILE_WEST_BLOCKED : RegionManager.PROJECTILE_EAST_BLOCKED);
        let yFlags = RegionManager.UNLOADED_TILE | RegionManager.UNKNOWN |
            RegionManager.PROJECTILE_TILE_BLOCKED |
            (north ? RegionManager.PROJECTILE_SOUTH_BLOCKED : RegionManager.PROJECTILE_NORTH_BLOCKED);
        const scale = 65536;
        const halfTile = scale / 2;

        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            const offsetX = east ? 1 : -1;
            let scaledY = startY * scale + halfTile + (north ? 0 : -1);
            const tangent = Math.trunc(deltaY * scale / Math.abs(deltaX));
            for (let x = startX; x !== endX;) {
                x += offsetX;
                const y = Math.floor(scaledY / scale);
                const atEnd = x === endX && y === endY;
                if ((RegionManager.getClipping(x, y, height, privateArea) &
                    (atEnd ? xFlags & ~RegionManager.PROJECTILE_TILE_BLOCKED : xFlags)) !== 0) return false;
                scaledY += tangent;
                const nextY = Math.floor(scaledY / scale);
                const nextAtEnd = x === endX && nextY === endY;
                if (nextY !== y && (RegionManager.getClipping(x, nextY, height, privateArea) &
                    (nextAtEnd ? yFlags & ~RegionManager.PROJECTILE_TILE_BLOCKED : yFlags)) !== 0) return false;
            }
        } else {
            const offsetY = north ? 1 : -1;
            let scaledX = startX * scale + halfTile + (east ? 0 : -1);
            const tangent = Math.trunc(deltaX * scale / Math.abs(deltaY));
            for (let y = startY; y !== endY;) {
                y += offsetY;
                const x = Math.floor(scaledX / scale);
                const atEnd = x === endX && y === endY;
                if ((RegionManager.getClipping(x, y, height, privateArea) &
                    (atEnd ? yFlags & ~RegionManager.PROJECTILE_TILE_BLOCKED : yFlags)) !== 0) return false;
                scaledX += tangent;
                const nextX = Math.floor(scaledX / scale);
                const nextAtEnd = nextX === endX && y === endY;
                if (nextX !== x && (RegionManager.getClipping(nextX, y, height, privateArea) &
                    (nextAtEnd ? xFlags & ~RegionManager.PROJECTILE_TILE_BLOCKED : xFlags)) !== 0) return false;
            }
        }
        return true;
    }
    public static canMove(startX: number, startY: number, endX: number, endY: number, height: number, xLength: number, yLength: number, privateArea: PrivateArea): boolean {
        let diffX = endX - startX;
        let diffY = endY - startY;
        let max = Math.max(Math.abs(diffX), Math.abs(diffY));
        for (let ii = 0; ii < max; ii++) {
            let currentX = endX - diffX;
            let currentY = endY - diffY;
            for (let i = 0; i < xLength; i++) {
                for (let i2 = 0; i2 < yLength; i2++)
                    if (diffX < 0 && diffY < 0) {
                        if ((RegionManager.getClipping((currentX + i) - 1, (currentY + i2) - 1, height, privateArea) & 0x128010e) !== 0
                            || (RegionManager.getClipping((currentX + i) - 1, currentY + i2, height, privateArea) & 0x1280108) !== 0
                            || (RegionManager.getClipping(currentX + i, (currentY + i2) - 1, height, privateArea) & 0x1280102) !== 0)
                            return false;
                    } else if (diffX > 0 && diffY > 0) {
                        if ((RegionManager.getClipping(currentX + i + 1, currentY + i2 + 1, height, privateArea) & 0x12801e0) !== 0
                            || (RegionManager.getClipping(currentX + i + 1, currentY + i2, height, privateArea) & 0x1280180) !== 0
                            || (RegionManager.getClipping(currentX + i, currentY + i2 + 1, height, privateArea) & 0x1280120) !== 0)
                            return false;
                    } else if (diffX < 0 && diffY > 0) {
                        if ((RegionManager.getClipping((currentX + i) - 1, currentY + i2 + 1, height, privateArea) & 0x1280138) !== 0
                            || (RegionManager.getClipping((currentX + i) - 1, currentY + i2, height, privateArea) & 0x1280108) !== 0
                            || (RegionManager.getClipping(currentX + i, currentY + i2 + 1, height, privateArea) & 0x1280120) !== 0)
                            return false;
                    } else if (diffX > 0 && diffY < 0) {
                        if ((RegionManager.getClipping(currentX + i + 1, (currentY + i2) - 1, height, privateArea) & 0x1280183) !== 0
                            || (RegionManager.getClipping(currentX + i + 1, currentY + i2, height, privateArea) & 0x1280180) !== 0
                            || (RegionManager.getClipping(currentX + i, (currentY + i2) - 1, height, privateArea) & 0x1280102) !== 0)
                            return false;
                    } else if (diffX > 0 && diffY === 0) {
                        if ((RegionManager.getClipping(currentX + i + 1, currentY + i2, height, privateArea) & 0x1280180) !== 0)
                            return false;
                    } else if (diffX < 0 && diffY === 0) {
                        if ((RegionManager.getClipping((currentX + i) - 1, currentY + i2, height, privateArea) & 0x1280108) !== 0)
                            return false;
                    } else if (diffX === 0 && diffY > 0) {
                        if ((RegionManager.getClipping(currentX + i, currentY + i2 + 1, height, privateArea) & 0x1280120) !== 0)
                            return false;
                    } else if (diffX === 0 && diffY < 0
                        && (RegionManager.getClipping(currentX + i, (currentY + i2) - 1, height, privateArea) & 0x1280102) !== 0)
                        return false;

            }

            if (diffX < 0) {
                diffX++;
            }
            else if (diffX > 0) {
                diffX--;
            }
            if (diffY < 0) {
                diffY++;
            }
            else if (diffY > 0)
                diffY--;
        }

        return true;
    }

    public static canMovestart(start: Location, end: Location, xLength: number, yLength: number, privateArea: PrivateArea): boolean {
        return this.canMove(start.getX(), start.getY(), end.getX(), end.getY(), start.getZ(), xLength, yLength, privateArea);
    }

    public static canMoveposition(position: Location, direction: Direction, size: number, privateArea: PrivateArea): boolean {
        const end = position.transform(direction.getX(), direction.getY());
        return this.canMove(position.getX(), position.getY(), end.getX(), end.getY(), position.getZ(), size, size, privateArea);
    }

    private static clearRegionMapObjects(regionId: number): void {
        const absX = ((regionId >> 8) & 0xff) * 64;
        const absY = (regionId & 0xff) * 64;
        for (let z = 0; z < 4; z++) {
            for (let localX = 0; localX < 64; localX++) {
                for (let localY = 0; localY < 64; localY++) {
                    const hash = MapObjects.getHash(absX + localX, absY + localY, z);
                    MapObjects.mapObjects.delete(hash);
                }
            }
        }
    }

    public static reloadRegion(regionId: number): boolean {
        const region = RegionManager.getRegionid(regionId);
        if (!region) {
            return false;
        }
        RegionManager.loadingRegions.delete(regionId);
        RegionManager.clearRegionMapObjects(regionId);
        region.clips = undefined;
        region.roofTiles = undefined;
        region.waterTiles = undefined;
        region.setLoaded(false);

        const absX = ((regionId >> 8) & 0xff) * 64;
        const absY = (regionId & 0xff) * 64;
        RegionManager.loadMapFiles(absX, absY);
        return region.isLoaded();
    }

    public static loadMapFiles(x: number, y: number, loadSurroundings = true) {
        try {
            const regionId = RegionManager.regionIdForTile(x, y);
            const r: Region = RegionManager.getRegionid(regionId);

            if (r == null || r == undefined || !r) {
                return;
            }
            if (RegionManager.loadingRegions.has(regionId) || r.isLoaded()) {
                return;
            }
            RegionManager.loadingRegions.add(regionId);


            // Attempt to create streams..
            const replacement = MapRegionReplacementManager.getReplacementMapData(regionId);
            const cached = CacheMaps.getRegion(regionId);
            const gFileData = replacement?.terrainData
                ? replacement.terrainData
                : cached?.terrainData;
            const oFileData = replacement
                ? (replacement.objectData ?? cached?.objectData)
                : cached?.objectData;

            // Don't allow ground file to be invalid..
            if (!gFileData) {
                RegionManager.loadingRegions.delete(regionId);
                return;
            }

            // Read values using our streams..
            const groundStream = new Buffer(gFileData);
            const absX = (r.getRegionId() >> 8) * 64;
            const absY = (r.getRegionId() & 0xff) * 64;
            const heightMap = Array.from({ length: 4 }, () =>
                Array.from({ length: 64 }, () => new Array(64).fill(0))
            );
            const roofTiles = new Uint8Array(2048);
            const waterTiles = new Uint8Array(512);
            const newTerrainFormat = CachePipeline.getActive().revision >= 209;
            for (let z = 0; z < 4; z++) {
                for (let tileX = 0; tileX < 64; tileX++) {
                    for (let tileY = 0; tileY < 64; tileY++) {
                        let overlayId = 0;
                        while (true) {
                            const tileType = newTerrainFormat
                                ? groundStream.readUShort()
                                : groundStream.readUnsignedByte();
                            if (tileType === 0) {
                                break;
                            } else if (tileType === 1) {
                                groundStream.readUnsignedByte();
                                break;
                            } else if (tileType <= 49) {
                                overlayId = newTerrainFormat
                                    ? groundStream.readUShort()
                                    : groundStream.readUnsignedByte();
                            } else if (tileType <= 81) {
                                heightMap[z][tileX][tileY] = tileType - 49;
                                if (((tileType - 49) & Region.TILE_FLAG_UNDER_ROOF) !== 0) {
                                    const index = (z << 12) | (tileX << 6) | tileY;
                                    roofTiles[index >> 3] |= 1 << (index & 7);
                                }
                            }
                        }
                        if (z === 0 && isWaterOverlayId(overlayId)) {
                            const index = (tileX << 6) | tileY;
                            waterTiles[index >> 3] |= 1 << (index & 7);
                        }
                    }
                }
            }
            r.waterTiles = waterTiles;
            for (let i = 0; i < 4; i++) {
                for (let i2 = 0; i2 < 64; i2++) {
                    for (let i3 = 0; i3 < 64; i3++) {
                        if ((heightMap[i][i2][i3] & 1) === 1) {
                            let height = i;
                            if ((heightMap[1][i2][i3] & 2) === 2) {
                                height--;
                            }
                            if (height >= 0 && height <= 3) {
                                RegionManager.addClipping(absX + i2, absY + i3, height, 0x200000, null, r);
                            }
                        }
                    }
                }
            }

            if (oFileData != null) {
                const objectStream = new Buffer(oFileData);
                let objectId = -1;
                let incr;
                while ((incr = objectStream.readSmart()) !== 0) {
                    objectId += incr;
                    let location = 0;
                    let incr2;
                    while ((incr2 = objectStream.getUSmart()) !== 0) {
                        location += incr2 - 1;
                        const localX = (location >> 6 & 0x3f);
                        const localY = (location & 0x3f);
                        let height = location >> 12;
                        const hash = objectStream.readUnsignedByte();
                        const type = hash >> 2;
                        const direction = hash & 0x3;
                        if (localX < 0 || localX >= 64 || localY < 0 || localY >= 64) {
                            continue;
                        }
                        if ((heightMap[1][localX][localY] & 2) === 2) {
                            height--;
                        }

                        // Add object..
                        if (height >= 0 && height <= 3) {
                            RegionManager.addObject(objectId, absX + localX, absY + localY, height, type, direction);
                        }
                    }
                }
            }
            r.roofTiles = roofTiles;
            r.setLoaded(true);
            PluginManager.emitRegionLoaded({
                regionId,
                absX,
                absY,
            });
            RegionManager.loadingRegions.delete(regionId);
            if (loadSurroundings) {
                const mapX = regionId >> 8;
                const mapY = regionId & 0xff;
                for (let deltaX = -1; deltaX <= 1; deltaX++) {
                    for (let deltaY = -1; deltaY <= 1; deltaY++) {
                        if (deltaX !== 0 || deltaY !== 0) {
                            RegionManager.loadMapFiles(
                                (mapX + deltaX) * 64,
                                (mapY + deltaY) * 64,
                                false
                            );
                        }
                    }
                }
            }
        } catch (e) {
            console.error(e);
            RegionManager.loadingRegions.delete(RegionManager.regionIdForTile(x, y));
        }
    }
}
