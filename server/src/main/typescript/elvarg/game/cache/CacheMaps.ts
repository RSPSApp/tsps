import { CacheIndexDat2 } from "./codec/rs/cache/CacheIndex";
import { IndexType } from "./codec/rs/cache/IndexType";
import { CachePipeline } from "./CachePipeline";

type MapData = { terrainData: Uint8Array; objectData?: Uint8Array };

export class CacheMaps {
  private static state?: {
    maps: CacheIndexDat2;
    named: boolean;
  };

  private static getState() {
    if (this.state) return this.state;
    const maps = CacheIndexDat2.fromStore(IndexType.DAT2.maps, CachePipeline.getStore());
    return this.state = { maps, named: maps.table.named };
  }

  public static getArchiveIds(regionId: number): { terrainFile: number; objectFile: number } | null {
    const { maps, named } = this.getState();
    const mapX = regionId >> 8;
    const mapY = regionId & 0xff;
    const terrainFile = named ? maps.getArchiveId(`m${mapX}_${mapY}`) : regionId;
    const objectFile = named ? maps.getArchiveId(`l${mapX}_${mapY}`) : regionId;
    return terrainFile !== -1 && objectFile !== -1 && maps.archiveExists(terrainFile) &&
      maps.archiveExists(objectFile) ? { terrainFile, objectFile } : null;
  }

  public static getRegionIds(): number[] {
    const { maps, named } = this.getState();
    if (!named) return Array.from(maps.getArchiveIds()).filter((id) => id >= 0 && id <= 0xffff);
    const ids: number[] = [];
    for (let mapX = 0; mapX < 256; mapX++) {
      for (let mapY = 0; mapY < 256; mapY++) {
        const id = (mapX << 8) | mapY;
        if (this.getArchiveIds(id)) ids.push(id);
      }
    }
    return ids;
  }

  public static getRegion(regionId: number): MapData | null {
    const state = this.getState();
    const ids = this.getArchiveIds(regionId);
    if (!ids) return null;
    try {
      const terrainFileId = 0;
      const objectFileId = state.named ? 0 : 1;
      const terrainData = state.maps.getFile(ids.terrainFile, terrainFileId)?.data;
      if (!terrainData) return null;
      const objectData = state.maps.getFile(
          ids.objectFile,
          objectFileId,
          CachePipeline.getXtea(ids.objectFile),
        )?.data;
      return {
        terrainData: new Uint8Array(terrainData.buffer, terrainData.byteOffset, terrainData.byteLength),
        objectData: objectData
          ? new Uint8Array(objectData.buffer, objectData.byteOffset, objectData.byteLength)
          : undefined,
      };
    } catch {
      return null;
    }
  }
}
