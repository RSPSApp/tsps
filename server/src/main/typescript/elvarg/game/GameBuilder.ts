import { CombatPoisonData } from '../game/task/impl/CombatPoisonEffect'
import { Sailing } from "./content/sailing/Sailing";
import { PlayerPunishment } from "../util/PlayerPunishment";
import { Systems } from "./Systems";
import { RegionManager } from "./collision/RegionManager";
import { GameEngine } from "./GameEngine";
import { ObjectSpawnDefinitionLoader } from "./definition/loader/impl/ObjectSpawnDefinitionLoader";
import { NpcDefinitionLoader } from "./definition/loader/impl/NpcDefinitionLoader";
import { InterfaceLayoutDefinitionLoader } from "./definition/loader/impl/InterfaceLayoutDefinitionLoader";
import { NpcSpawnDefinitionLoader } from "./definition/loader/impl/NpcSpawnDefinitionLoader";
import { ShopDefinitionLoader } from "./definition/loader/impl/ShopDefinitionLoader";
import { NpcInteractionDefinitionLoader } from "./definition/loader/impl/NpcInteractionDefinitionLoader";
import { ShopManager } from "./model/container/shop/ShopManager";
import { PluginManager } from "../plugins/PluginManager";

export class GameBuilder {
    public initialize(): void {
        // Setup systems
        Systems.init();
    
        // Start immediate tasks..
        RegionManager.init();
    
        // Load startup data before the engine begins ticking.
        this.loadStartupData();
    
        // Start global tasks..
    
        // Start game engine..
        new GameEngine().init();

        PluginManager.emitServerStartup({ timestamp: Date.now() });
    }
    
    private loadStartupData(): void {
        CombatPoisonData.init();
        PlayerPunishment.init();
        new NpcInteractionDefinitionLoader().load();
        new InterfaceLayoutDefinitionLoader().load();
        new ObjectSpawnDefinitionLoader().load();
        new NpcDefinitionLoader().load();
        new NpcSpawnDefinitionLoader().load();
        new ShopDefinitionLoader().load();
        ShopManager.initialize();
        Sailing.initialize();
    }
}
