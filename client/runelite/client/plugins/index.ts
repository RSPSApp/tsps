import { AnimationSmoothingPlugin } from "../../../game/plugins/animationsmoothing/AnimationSmoothingPlugin";
import { AttackTimerPlugin } from "../../../game/plugins/attacktimer/AttackTimerPlugin";
import { FirstPersonPlugin } from "../../../game/plugins/firstperson/FirstPersonPlugin";
import { GameFrame317Plugin } from "../../../game/plugins/gameframe317/GameFrame317Plugin";
import { GroundItemsConfig } from "../../../game/plugins/grounditems/GroundItemsConfig";
import { GroundItemsPlugin } from "../../../game/plugins/grounditems/GroundItemsPlugin";
import { HdPlugin } from "../../../game/plugins/hd/HdPlugin";
import { InteractHighlightConfig } from "../../../game/plugins/interacthighlight/InteractHighlightConfig";
import { InteractHighlightPlugin } from "../../../game/plugins/interacthighlight/InteractHighlightPlugin";
import { MenuSwapperPlugin } from "../../../game/plugins/menuswapper/MenuSwapperPlugin";
import { NotesConfig } from "../../../game/plugins/notes/NotesPlugin";
import { NotesPlugin } from "../../../game/plugins/notes/NotesPlugin";
import { RememberLoginPlugin } from "../../../game/plugins/rememberlogin/RememberLoginPlugin";
import { SplitPrivateChatPlugin } from "../../../game/plugins/splitprivatechat/SplitPrivateChatPlugin";
import { StatusBarsPlugin } from "../../../game/plugins/statusbars/StatusBarsPlugin";
import {
    FreezeTimerPlugin,
    PoisonTimerPlugin,
} from "../../../game/plugins/statustimer/StatusTimerPlugin";
import { TileMarkersConfig } from "../../../game/plugins/tilemarkers/TileMarkersConfig";
import { TileMarkersPlugin } from "../../../game/plugins/tilemarkers/TileMarkersPlugin";
import { VengeanceTimerPlugin } from "../../../game/plugins/vengeancetimer/VengeanceTimerPlugin";
import { WeatherPlugin } from "../../../game/plugins/weather/WeatherPlugin";
import type { LegacyConfigMigration } from "../../impl/LegacyConfigMigration";
import { ConfigPlugin } from "./config/ConfigPlugin";
import type { PluginClass } from "./Plugin";

/** Static core plugin list (RuneLite's `PluginManager.loadCorePlugins`). */
export const CORE_PLUGINS: ReadonlyArray<PluginClass> = [
    ConfigPlugin,
    HdPlugin,
    FirstPersonPlugin,
    GameFrame317Plugin,
    GroundItemsPlugin,
    InteractHighlightPlugin,
    TileMarkersPlugin,
    MenuSwapperPlugin,
    NotesPlugin,
    RememberLoginPlugin,
    SplitPrivateChatPlugin,
    AnimationSmoothingPlugin,
    AttackTimerPlugin,
    VengeanceTimerPlugin,
    PoisonTimerPlugin,
    FreezeTimerPlugin,
    WeatherPlugin,
    StatusBarsPlugin,
];

/** Legacy `osrs.plugin.*.v1` localStorage blobs to fold into rl.config. */
export const LEGACY_CONFIG_MIGRATIONS: ReadonlyArray<LegacyConfigMigration> = [
    {
        name: "grounditems",
        legacyKey: "osrs.plugin.ground_items.v1",
        config: GroundItemsConfig,
        enabledKey: "grounditemsplugin",
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
        config: TileMarkersConfig,
        enabledKey: "tilemarkersplugin",
    },
    {
        name: "animationsmoothing",
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
        name: "rememberlogin",
        legacyKey: "osrs.plugin.remember_login.v1",
        enabledKey: "rememberloginplugin",
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
