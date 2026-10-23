import { CacheInfo } from "../../cache/CacheInfo";
import { CacheSystem } from "../../cache/CacheSystem";
import { IndexType } from "../../cache/IndexType";
import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";
import { DefaultsGroup } from "./DefaultsGroup";

export class GraphicsDefaults extends Type {
    compass: number = -1;
    mapEdge: number = -1;
    mapScenes: number = -1;
    mapFunctions: number = -1;
    headIconsPk: number = -1;
    headIconsPrayer: number = -1;
    headIconsHint: number = -1;
    mapMarkers: number = -1;
    crosses: number = -1;
    mapDots: number = -1;
    scrollBars: number = -1;
    modIcons: number = -1;
    /**
     * The helm's heading indicator models (graphics defaults opcode 4/5): the white arrow that
     * follows the mouse, then the yellow one shown where a heading was set.
     */
    headingIndicatorModels: [number, number] = [-1, -1];
    /**
     * The login screen's flame palettes (opcode 3): the base palette, then the two it flashes to,
     * each five colours the palette runs through (classic: black, red, yellow, white, white).
     */
    flamePalettes: number[][] | undefined;

    static load(cacheInfo: CacheInfo, fileSystem: CacheSystem): GraphicsDefaults {
        if (
            cacheInfo.game === "oldschool" &&
            fileSystem.indexExists(IndexType.OSRS.graphicDefaults)
        ) {
            const defaultsIndex = fileSystem.getIndex(IndexType.OSRS.graphicDefaults);
            const defaultsFile = defaultsIndex.getFile(DefaultsGroup.GRAPHICS, 0);
            if (!defaultsFile) {
                throw new Error("GraphicsDefaults: File not found");
            }

            const defaults = new GraphicsDefaults(defaultsFile.archiveId, cacheInfo);
            defaults.decode(new ByteBuffer(defaultsFile.data));

            return defaults;
        } else if (
            cacheInfo.game === "runescape" &&
            fileSystem.indexExists(IndexType.RS2.defaults)
        ) {
            const defaults = new GraphicsDefaults(-1, cacheInfo);

            return defaults;
        } else {
            const spriteIndex = fileSystem.getIndex(IndexType.DAT2.sprites);

            const defaults = new GraphicsDefaults(-1, cacheInfo);
            defaults.compass = spriteIndex.getArchiveId("compass");
            defaults.mapEdge = spriteIndex.getArchiveId("mapedge");
            defaults.mapScenes = spriteIndex.getArchiveId("mapscene");
            defaults.mapFunctions = spriteIndex.getArchiveId("mapfunction");
            defaults.headIconsPk = spriteIndex.getArchiveId("headicons_pk");
            defaults.headIconsPrayer = spriteIndex.getArchiveId("headicons_prayer");
            defaults.headIconsHint = spriteIndex.getArchiveId("headicons_hint");
            defaults.mapMarkers = spriteIndex.getArchiveId("mapmarker");
            defaults.crosses = spriteIndex.getArchiveId("cross");
            defaults.mapDots = spriteIndex.getArchiveId("mapdots");
            defaults.scrollBars = spriteIndex.getArchiveId("scrollbar");
            defaults.modIcons = spriteIndex.getArchiveId("mod_icons");

            return defaults;
        }
    }

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        switch (opcode) {
            case 1:
                buffer.readMedium();
                break;
            case 2:
            // Rev 241 sends the sprites as opcode 6, with a twelfth (unnamed) sprite at the end
            // (zwyz/osrs-cache GraphicsDefaultsUnpacker).
            case 6:
                this.compass = buffer.readBigSmart();
                this.mapEdge = buffer.readBigSmart();
                this.mapScenes = buffer.readBigSmart();
                this.headIconsPk = buffer.readBigSmart();
                this.headIconsPrayer = buffer.readBigSmart();
                this.headIconsHint = buffer.readBigSmart();
                this.mapMarkers = buffer.readBigSmart();
                this.crosses = buffer.readBigSmart();
                this.mapDots = buffer.readBigSmart();
                this.scrollBars = buffer.readBigSmart();
                this.modIcons = buffer.readBigSmart();
                if (opcode === 6) buffer.readBigSmart();
                break;
            case 3:
                this.flamePalettes = [];
                for (let palette = 0; palette < 3; palette++) {
                    const colours: number[] = [];
                    for (let i = 0; i < 5; i++) colours.push(buffer.readMedium());
                    this.flamePalettes.push(colours);
                }
                break;
            case 4:
                this.headingIndicatorModels = [buffer.readBigSmart(), buffer.readBigSmart()];
                break;
            case 5:
                // The same pair as ints, for model ids too large for a big smart.
                this.headingIndicatorModels = [buffer.readInt(), buffer.readInt()];
                break;
        }
    }
}
