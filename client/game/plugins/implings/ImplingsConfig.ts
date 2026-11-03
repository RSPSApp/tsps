import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** RuneLite's ImplingsConfig.ImplingMode. */
export const ImplingMode = { NONE: "NONE", HIGHLIGHT: "HIGHLIGHT", NOTIFY: "NOTIFY" } as const;
export type ImplingMode = keyof typeof ImplingMode;

/** RuneLite's implingSection key. */
const SECTION = "implings";

const mode = (keyName: string, name: string, description: string, position: number, value: ImplingMode = "NONE") =>
    ConfigItem<string>({ keyName, name, description, position, section: SECTION, enum: ImplingMode, default: value });

const colour = (keyName: string, name: string, description: string, position: number, argb: number) =>
    ConfigItem({ keyName, name, description, position, section: SECTION, color: true, alpha: true, default: argb });

/** RuneLite 1.13.5 ImplingsConfig: group, keys, names, defaults and order as in RuneLite. */
export const ImplingsConfig = ConfigGroup(
    "implings",
    {
        showBaby: mode("showbaby", "Baby implings", "Configures whether or not baby impling tags are displayed.", 1),
        babyColor: colour("babyColor", "Baby impling color", "Text color for baby implings.", 2, 0xffb18fb3),
        showYoung: mode("showyoung", "Young implings", "Configures whether or not young impling tags are displayed.", 3),
        youngColor: colour("youngColor", "Young impling color", "Text color for young implings.", 4, 0xffafa488),
        showGourmet: mode("showgourmet", "Gourmet implings", "Configures whether or not gourmet impling tags are displayed.", 5),
        gourmetColor: colour("gourmetColor", "Gourmet impling color", "Text color for gourmet implings.", 6, 0xffa98362),
        showEarth: mode("showearth", "Earth implings", "Configures whether or not earth impling tags are displayed.", 7),
        earthColor: colour("earthColor", "Earth impling color", "Text color for earth implings.", 8, 0xff3e5640),
        showEssence: mode("showessence", "Essence implings", "Configures whether or not essence impling tags are displayed.", 9),
        essenceColor: colour("essenceColor", "Essence impling color", "Text color for essence implings.", 10, 0xff20595a),
        showEclectic: mode("showeclectic", "Eclectic implings", "Configures whether or not eclectic impling tags are displayed.", 11),
        eclecticColor: colour("eclecticColor", "Eclectic impling color", "Text color for eclectic implings.", 12, 0xff919b45),
        showNature: mode("shownature", "Nature implings", "Configures whether or not nature impling tags are displayed.", 13),
        natureColor: colour("natureColor", "Nature impling color", "Text color for nature implings.", 14, 0xff5c8a5f),
        showMagpie: mode("showmagpie", "Magpie implings", "Configures whether or not magpie impling tags are displayed.", 15),
        magpieColor: colour("magpieColor", "Magpie impling color", "Text color for magpie implings.", 16, 0xff8e8e13),
        showNinja: mode("showninja", "Ninja implings", "Configures whether or not ninja impling tags are displayed.", 17),
        ninjaColor: colour("ninjaColor", "Ninja impling color", "Text color for ninja implings.", 18, 0xff47464b),
        showCrystal: mode("showCrystal", "Crystal implings", "Configures whether or not crystal implings are displayed.", 19),
        crystalColor: colour("crystalColor", "Crystal impling color", "Text color for crystal implings.", 20, 0xff5dbcd2),
        showDragon: mode("showdragon", "Dragon implings", "Configures whether or not dragon impling tags are displayed.", 21, "HIGHLIGHT"),
        dragonColor: colour("dragonColor", "Dragon impling color", "Text color for dragon implings.", 22, 0xffd2554b),
        showLucky: mode("showlucky", "Lucky implings", "Configures whether or not lucky impling tags are displayed.", 23, "HIGHLIGHT"),
        luckyColor: colour("luckyColor", "Lucky impling color", "Text color for lucky implings.", 24, 0xff660765),
        showSpawn: ConfigItem({
            keyName: "showspawn",
            name: "Show spawn locations",
            description: "Configures whether or not spawn locations are displayed in Puro-Puro.",
            position: 25,
            default: false,
        }),
        spawnColor: ConfigItem({
            keyName: "spawnColor",
            name: "Impling spawn color",
            description: "Text color for impling spawns in Puro-Puro.",
            position: 26,
            color: true,
            alpha: true,
            default: 0xffffffff,
        }),
        showName: ConfigItem({
            keyName: "showname",
            name: "Show name on minimap",
            description: "Configures whether or not impling names are displayed on minimap.",
            position: 27,
            default: false,
        }),
    },
    {
        sections: {
            [SECTION]: { name: "Impling type settings", position: 99 },
        },
    },
);
