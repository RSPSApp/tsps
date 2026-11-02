import { AnimationSmoothingConfig } from "../../../game/plugins/animationsmoothing/AnimationSmoothingConfig";
import { BugReportPlugin } from "../../../game/plugins/bugreport/BugReportPlugin";
import { VoiceChatPlugin } from "../../../game/plugins/voice/VoiceChatPlugin";
import { AnimationSmoothingPlugin } from "../../../game/plugins/animationsmoothing/AnimationSmoothingPlugin";
import { AttackTimerPlugin } from "../../../game/plugins/attacktimer/AttackTimerPlugin";
import { BankTagsPlugin } from "../../../game/plugins/banktags/BankTagsPlugin";
import { CameraPlugin } from "../../../game/plugins/camera/CameraPlugin";
import { QuestHelperPlugin } from "../../../game/plugins/questhelper/QuestHelperPlugin";
import { FirstPersonPlugin } from "../../../game/plugins/firstperson/FirstPersonPlugin";
import { TouchControlsPlugin } from "../../../game/plugins/touchcontrols/TouchControlsPlugin";
import { GameFrame317Plugin } from "../../../game/plugins/gameframe317/GameFrame317Plugin";
import { GpuPlugin } from "../../../game/plugins/gpu/GpuPlugin";
import { GroundItemsConfig } from "../../../game/plugins/grounditems/GroundItemsConfig";
import { GroundItemsPlugin } from "../../../game/plugins/grounditems/GroundItemsPlugin";
import { GroundMarkerPlugin } from "../../../game/plugins/groundmarkers/GroundMarkerPlugin";
import { HdPlugin } from "../../../game/plugins/hd/HdPlugin";
import { InteractHighlightConfig } from "../../../game/plugins/interacthighlight/InteractHighlightConfig";
import { InteractHighlightPlugin } from "../../../game/plugins/interacthighlight/InteractHighlightPlugin";
import { InventoryTagsPlugin } from "../../../game/plugins/inventorytags/InventoryTagsPlugin";
import { ItemStatsPlugin } from "../../../game/plugins/itemstats/ItemStatsPlugin";
import { ItemRarityPlugin } from "../../../game/plugins/itemrarity/ItemRarityPlugin";
import { MenuSwapperPlugin } from "../../../game/plugins/menuswapper/MenuSwapperPlugin";
import { NotesConfig } from "../../../game/plugins/notes/NotesPlugin";
import { ObjectIndicatorsPlugin } from "../../../game/plugins/objectindicators/ObjectIndicatorsPlugin";
import { NpcIndicatorsPlugin } from "../../../game/plugins/npcindicators/NpcIndicatorsPlugin";
import { NotesPlugin } from "../../../game/plugins/notes/NotesPlugin";
import { SplitPrivateChatPlugin } from "../../../game/plugins/splitprivatechat/SplitPrivateChatPlugin";
import { StatusBarsPlugin } from "../../../game/plugins/statusbars/StatusBarsPlugin";
import { StretchedModePlugin } from "../../../game/plugins/stretchedmode/StretchedModePlugin";
import { OpponentInfoPlugin } from "../../../game/plugins/opponentinfo/OpponentInfoPlugin";
import { PrayerPlugin } from "../../../game/plugins/tabreorder/PrayerPlugin";
import { FairyRingPlugin } from "../../../game/plugins/fairyring/FairyRingPlugin";
import { PestControlPlugin } from "../../../game/plugins/pestcontrol/PestControlPlugin";
import { SpellbookPlugin } from "../../../game/plugins/tabreorder/SpellbookPlugin";
import {
    FreezeTimerPlugin,
    PoisonTimerPlugin,
} from "../../../game/plugins/statustimer/StatusTimerPlugin";
import { LegacyTileMarkersConfig } from "../../../game/plugins/tilemarkers/migrateTileMarkers";
import { TileMarkersPlugin } from "../../../game/plugins/tilemarkers/TileMarkersPlugin";
import { TilePacksPlugin } from "../../../game/plugins/tilepacks/TilePacksPlugin";
import { VengeanceTimerPlugin } from "../../../game/plugins/vengeancetimer/VengeanceTimerPlugin";
import { WeatherPlugin } from "../../../game/plugins/weather/WeatherPlugin";
import { XpTrackerPlugin } from "../../../game/plugins/xptracker/XpTrackerPlugin";
import { XpGlobesPlugin } from "../../../game/plugins/xpglobes/XpGlobesPlugin";
import { GuidePlugin } from "../../../game/plugins/optimalquestguide/GuidePlugin";
import { ShortestPathPlugin } from "../../../game/plugins/shortestpath/ShortestPathPlugin";
import type { LegacyConfigMigration } from "../../impl/LegacyConfigMigration";
import { migrateGroundItemsConfig } from "../../../game/plugins/grounditems/migrateGroundItems";
import { ConfigPlugin } from "./config/ConfigPlugin";
import type { PluginClass } from "./Plugin";

/** Static core plugin list (RuneLite's `PluginManager.loadCorePlugins`). */
export const CORE_PLUGINS: ReadonlyArray<PluginClass> = [
    ConfigPlugin,
    VoiceChatPlugin,
    HdPlugin,
    FirstPersonPlugin,
    TouchControlsPlugin,
    GameFrame317Plugin,
    GroundItemsPlugin,
    InteractHighlightPlugin,
    GroundMarkerPlugin,
    TileMarkersPlugin,
    TilePacksPlugin,
    MenuSwapperPlugin,
    // After Menu Swapper: its "Inventory tag" submenu joins the swapped menu.
    InventoryTagsPlugin,
    ItemStatsPlugin,
    ItemRarityPlugin,
    BankTagsPlugin,
    NotesPlugin,
    NpcIndicatorsPlugin,
    ObjectIndicatorsPlugin,
    SplitPrivateChatPlugin,
    AnimationSmoothingPlugin,
    AttackTimerPlugin,
    VengeanceTimerPlugin,
    PoisonTimerPlugin,
    FreezeTimerPlugin,
    WeatherPlugin,
    StatusBarsPlugin,
    OpponentInfoPlugin,
    SpellbookPlugin,
    PrayerPlugin,
    PestControlPlugin,
    FairyRingPlugin,
    StretchedModePlugin,
    GpuPlugin,
    CameraPlugin,
    QuestHelperPlugin,
    XpTrackerPlugin,
    XpGlobesPlugin,
    GuidePlugin,
    ShortestPathPlugin,
    // After VoiceChatPlugin: while voice chat holds the chatbox Report button, its clicks are voice's.
    BugReportPlugin,
];

/** Legacy `osrs.plugin.*.v1` localStorage blobs to fold into rl.config. */
export const LEGACY_CONFIG_MIGRATIONS: ReadonlyArray<LegacyConfigMigration> = [
    {
        name: "grounditems",
        legacyKey: "osrs.plugin.ground_items.v1",
        config: GroundItemsConfig,
        fieldMap: { rightClickHidden: "deprioritizeHiddenItems", despawnTimerMode: "groundItemTimers" },
        enabledKey: "grounditemsplugin",
        migrate: migrateGroundItemsConfig,
    },
    {
        name: "interacthighlight",
        legacyKey: "osrs.plugin.interact_highlight.v1",
        config: InteractHighlightConfig,
        enabledKey: "interacthighlightplugin",
    },
    {
        name: "tilemarkers",
        legacyKey: "osrs.plugin.tile_markers.v1",
        // Into the old keys; migrateTileMarkersConfig then moves them to Tile Indicators'.
        config: LegacyTileMarkersConfig,
        enabledKey: "tilemarkersplugin",
    },
    {
        name: "animationsmoothing",
        config: AnimationSmoothingConfig,
        legacyKey: "osrs.plugin.animation_smoothing.v1",
        enabledKey: "animationsmoothingplugin",
    },
    {
        name: "attacktimer",
        legacyKey: "osrs.plugin.attack_timer.v1",
        enabledKey: "attacktimerplugin",
    },
    {
        name: "vengeancetimer",
        legacyKey: "osrs.plugin.vengeance_timer.v1",
        enabledKey: "vengeancetimerplugin",
    },
    {
        name: "poisontimer",
        legacyKey: "osrs.plugin.poison_timer.v1",
        enabledKey: "poisontimerplugin",
    },
    {
        name: "freezetimer",
        legacyKey: "osrs.plugin.freeze_timer.v1",
        enabledKey: "freezetimerplugin",
    },
    {
        name: "hd",
        legacyKey: "xrsps.plugin.hd.enabled",
        enabledKey: "hdplugin",
    },
    {
        name: "menuswapper",
        legacyKey: "osrs.plugin.menu_swapper.v1",
        enabledKey: "menuentryswapper",
    },
    {
        name: "notes",
        legacyKey: "osrs.plugin.notes.v1",
        config: NotesConfig,
        enabledKey: "notesplugin",
        ignore: ["notes"],
    },
    {
        name: "notes-sidebar",
        legacyKey: "osrs.sidebar.notes",
        config: NotesConfig,
        rawStringAs: "notes",
    },
];
