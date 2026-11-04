import type { Client, WorldPoint } from "@runelite/api/Client";
import type { ConfigChanged, GameTick } from "@runelite/api/events";
import {
    GRACEFUL_BOOTS,
    GRACEFUL_CAPE,
    GRACEFUL_GLOVES,
    GRACEFUL_HOOD,
    GRACEFUL_LEGS,
    GRACEFUL_TOP,
    RING_OF_ENDURANCE,
    SKILLCAPE_AGILITY,
    SKILLCAPE_MAX_WORN,
} from "@runelite/api/gameval/ItemID";
import { STAMINA_ACTIVE } from "@runelite/api/gameval/VarbitID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { getVariations } from "@runelite/client/game/ItemVariationMapping";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { type Tooltip, TooltipManager } from "@runelite/client/ui/overlay/tooltip/TooltipManager";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import { chatHistory, type ChatHistoryStore, type ChatMessage } from "../../../rs/cs2/ChatHistory";
import { SkillId } from "../../../rs/skill/skills";
import { ClientState } from "../../ClientState";
import type { OsrsClient } from "../../OsrsClient";
import { OrbComponent, orbBounds, orbWidgets } from "../orbWidgets";
import { RunEnergyConfig } from "./RunEnergyConfig";

/** RuneLite's Constants.GAME_TICK_LENGTH. */
const GAME_TICK_LENGTH = 600;
/** ScriptID.ORBS_UPDATE_RUNENERGY. */
const ORBS_UPDATE_RUNENERGY = 447;
const GAMEMESSAGE = 0;
const SPAM = 105;

/** RunEnergyPlugin.GracefulEquipmentSlot: the worn slot, its recovery boost (%) and its items. */
const GRACEFUL_SLOTS: { index: number; boost: number; items: ReadonlySet<number> }[] = [
    { index: 0, boost: 3, baseItems: [GRACEFUL_HOOD] },
    { index: 4, boost: 4, baseItems: [GRACEFUL_TOP] },
    { index: 7, boost: 4, baseItems: [GRACEFUL_LEGS] },
    { index: 9, boost: 3, baseItems: [GRACEFUL_GLOVES] },
    { index: 10, boost: 3, baseItems: [GRACEFUL_BOOTS] },
    // Agility skill capes and the non-cosmetic Max capes also count for the Graceful set effect
    { index: 1, boost: 3, baseItems: [GRACEFUL_CAPE, SKILLCAPE_AGILITY, SKILLCAPE_MAX_WORN] },
].map(({ index, boost, baseItems }) => ({ index, boost, items: new Set(baseItems.flatMap((item) => [...getVariations(item)])) }));
const TOTAL_BOOSTS = GRACEFUL_SLOTS.reduce((sum, slot) => sum + slot.boost, 0);
// Full set grants an extra 10% boost to recovery rate
const GRACEFUL_FULL_SET_BOOST_BONUS = 10;
// number of charges for roe passive effect
const RING_OF_ENDURANCE_PASSIVE_EFFECT = 500;

/** What Run Energy reads from the client, beyond RuneLite's Client. */
export type RunEnergyClient = Pick<Client, "getEnergy" | "getBoostedSkillLevel" | "getVarbitValue" | "getLocalPlayer"> & {
    /** Weight in kg. */
    getWeight(): number;
    /** The worn items by slot (-1 for an empty slot). */
    getWornItems(): number[];
    /** Whether the player has somewhere to walk to (client.getLocalDestinationLocation() != null). */
    hasDestination(): boolean;
    /** The mouse over the run orb (RuneLite checks the orb's bounds). */
    isMouseOverRunOrb(): boolean;
    /** The account the ring of endurance charges belong to (RuneLite's RS profile). */
    getAccount(): string;
    /** ChatMessageManager: a CONSOLE message in the chatbox. */
    sendChatMessage(message: string): void;
    /** Sets the run orb's energy text. */
    setRunOrbText(text: string): void;
};

/**
 * RuneLite 1.13.5 Run Energy: hovering the run orb shows your weight, the time your energy lasts
 * running and the time to 100%; it can also put the run time in the orb, and tracks a ring of
 * endurance's charges from its chat messages.
 */
export class RunEnergyPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Run Energy",
        description: "Show various information related to run energy",
        tags: ["overlay", "stamina"],
        configKey: "runenergyplugin",
    };

    static config = RunEnergyConfig;

    private readonly configManager = inject(ConfigManager);
    readonly config = this.configManager.getConfig(RunEnergyConfig);
    private readonly client: RunEnergyClient;
    private readonly tooltips: TooltipManager;
    private readonly history: ChatHistoryStore;
    private roeWarningSent = false;
    private localPlayerRunningToDestination = false;
    private prevLocalPlayerLocation: WorldPoint | null = null;
    private readonly source = () => this.tooltip();
    private readonly listener = (message: ChatMessage) => this.handleChatMessage(message);

    constructor(client?: RunEnergyClient, tooltips?: TooltipManager, history: ChatHistoryStore = chatHistory) {
        super();
        this.client = client ?? osrsRunEnergyClient(inject<OsrsClient>(CLIENT_TOKEN));
        this.tooltips = tooltips ?? inject(TooltipManager);
        this.history = history;
    }

    protected async startUp(): Promise<void> {
        this.tooltips.add(this.source);
        this.history.beforeInsertListeners.add(this.listener);
    }

    protected async shutDown(): Promise<void> {
        this.tooltips.remove(this.source);
        this.history.beforeInsertListeners.delete(this.listener);
        this.localPlayerRunningToDestination = false;
        this.prevLocalPlayerLocation = null;
        this.roeWarningSent = false;
        this.resetRunOrbText();
    }

    getRingOfEnduranceCharges(): number | null {
        const value = this.configManager.getConfiguration(RunEnergyConfig.group, this.chargesKey());
        if (value === undefined || value === "") return null;
        const charges = Number(value);
        return Number.isFinite(charges) ? charges : null;
    }

    setRingOfEnduranceCharges(charges: number): void {
        this.configManager.setConfiguration(RunEnergyConfig.group, this.chargesKey(), charges);
    }

    private chargesKey(): string {
        return `rsprofile.${this.client.getAccount()}.ringOfEnduranceCharges`;
    }

    isRingOfEnduranceEquipped(): boolean {
        return this.client.getWornItems().filter((item) => item === RING_OF_ENDURANCE).length === 1;
    }

    onGameTick(_event?: GameTick): void {
        if (!this.isStarted()) return;
        const local = this.client.getLocalPlayer();
        const location = local?.getWorldLocation() ?? null;
        this.localPlayerRunningToDestination = this.prevLocalPlayerLocation !== null
            && this.client.hasDestination()
            && location !== null
            && distanceTo(this.prevLocalPlayerLocation, location) > 1;
        if (location) this.prevLocalPlayerLocation = location;
    }

    onScriptFinished(scriptId: number): void {
        if (scriptId === ORBS_UPDATE_RUNENERGY && this.isStarted() && this.config.replaceOrbText() === true) {
            this.client.setRunOrbText(this.getEstimatedRunTimeRemaining(true));
        }
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === RunEnergyConfig.group && event.getKey() === "replaceOrbText"
            && this.config.replaceOrbText() !== true) {
            this.resetRunOrbText();
        }
    }

    /** Handle the history node before insertion, rather than the API EventBus payload. */
    private handleChatMessage(event: ChatMessage): void {
        if (!this.isStarted() || (event.type !== GAMEMESSAGE && event.type !== SPAM)) return;
        const message = event.text;
        if (message === "Your Ring of endurance doubles the duration of your stamina potion's effect.") {
            let charges = this.getRingOfEnduranceCharges();
            // Ring of endurance charge with no known charges
            if (charges === null) return;
            // subtract the used charge
            charges--;
            this.setRingOfEnduranceCharges(charges);
            if (!this.roeWarningSent && charges < RING_OF_ENDURANCE_PASSIVE_EFFECT
                && this.config.ringOfEnduranceChargeMessage() === true) {
                this.client.sendChatMessage(`<col=ff0000>Your Ring of endurance now has less than ${RING_OF_ENDURANCE_PASSIVE_EFFECT} charges. Add more charges to regain its passive stamina effect.`);
                this.roeWarningSent = true;
            }
        } else if (message.startsWith("Your Ring of endurance is charged with") || message.startsWith("You load your Ring of endurance with")) {
            let charges = -1;
            for (const match of message.matchAll(/([0-9,]+)/g)) charges = parseInt(match[1].replace(/,/g, ""), 10);
            this.setRingOfEnduranceCharges(charges);
            if (charges >= RING_OF_ENDURANCE_PASSIVE_EFFECT) this.roeWarningSent = false;
        }
    }

    private resetRunOrbText(): void {
        this.client.setRunOrbText(String(Math.trunc(this.client.getEnergy() / 100)));
    }

    getEstimatedRunTimeRemaining(inSeconds: boolean): string {
        // Calculate the amount of energy lost every tick.
        // Negative weight has the same depletion effect as 0 kg. >64kg counts as 64kg.
        const effectiveWeight = Math.min(Math.max(this.client.getWeight(), 0), 64);
        // 100% energy is 10000 energy units
        let energyUnitsLost = Math.trunc((60 + Math.trunc((67 * effectiveWeight) / 64))
            * (1 - this.client.getBoostedSkillLevel(SkillId.Agility) / 300.0));
        if (this.client.getVarbitValue(STAMINA_ACTIVE) !== 0) {
            energyUnitsLost = Math.trunc(energyUnitsLost * 0.3); // Stamina effect reduces energy depletion to 30%
        } else if (this.isRingOfEnduranceEquipped()) { // Ring of Endurance passive effect does not stack with stamina potion
            const charges = this.getRingOfEnduranceCharges();
            if (charges === null) return "?";
            if (charges >= RING_OF_ENDURANCE_PASSIVE_EFFECT) {
                energyUnitsLost = Math.trunc(energyUnitsLost * 0.85); // Ring of Endurance passive effect reduces energy depletion to 85%
            }
        }

        // Math.ceil is correct here - only need 1 energy unit to run
        const ticksLeft = Math.ceil(this.client.getEnergy() / energyUnitsLost);
        const secondsLeft = (ticksLeft * GAME_TICK_LENGTH) / 1000.0;

        // Return the text
        if (inSeconds) return `${Math.floor(secondsLeft)}s`;
        const minutes = Math.floor(secondsLeft / 60.0);
        const seconds = Math.floor(secondsLeft - minutes * 60.0);
        return `${minutes}:${String(seconds).padStart(2, "0")}`;
    }

    private getGracefulRecoveryBoost(): number {
        const items = this.client.getWornItems();
        let boost = 0;
        for (const slot of GRACEFUL_SLOTS) {
            if (items.length <= slot.index) continue;
            const wornItem = items[slot.index];
            if (wornItem >= 0 && slot.items.has(wornItem)) boost += slot.boost;
        }
        if (boost === TOTAL_BOOSTS) boost += GRACEFUL_FULL_SET_BOOST_BONUS;
        return boost;
    }

    getEstimatedRecoverTimeRemaining(): number {
        if (this.localPlayerRunningToDestination) return -1;
        // Calculate the amount of energy recovered every second
        let recoverRate = 25 + this.client.getBoostedSkillLevel(SkillId.Agility) / 6.0;
        recoverRate *= 1.0 + this.getGracefulRecoveryBoost() / 100.0;
        // Calculate the number of seconds left
        const secondsLeft = (10000 - this.client.getEnergy()) / recoverRate;
        return Math.trunc(secondsLeft);
    }

    /** RunEnergyOverlay.render: the run orb's tooltip while the mouse is over it. */
    tooltip(): Tooltip | undefined {
        if (!this.isStarted() || !this.client.isMouseOverRunOrb()) return undefined;
        let text = `Weight: ${this.client.getWeight()} kg</br>`;
        if (this.config.replaceOrbText() === true) {
            text += `Run Energy: ${Math.trunc(this.client.getEnergy() / 100)}%`;
        } else {
            text += `Run Time Remaining: ${this.getEstimatedRunTimeRemaining(false)}`;
        }
        if (this.client.getVarbitValue(STAMINA_ACTIVE) === 0 && this.isRingOfEnduranceEquipped()
            && this.getRingOfEnduranceCharges() === null) {
            text += "</br>Check your Ring of endurance to get the time remaining.";
        }
        const secondsUntil100 = this.getEstimatedRecoverTimeRemaining();
        if (secondsUntil100 > 0) {
            const minutes = Math.floor(secondsUntil100 / 60.0);
            const seconds = Math.floor(secondsUntil100 - minutes * 60.0);
            text += `</br>100% Energy In: ${minutes}:${String(seconds).padStart(2, "0")}`;
        }
        return { text };
    }
}

/** WorldPoint.distanceTo: Chebyshev distance on one plane, Integer.MAX_VALUE across planes. */
function distanceTo(a: WorldPoint, b: WorldPoint): number {
    if (a.plane !== b.plane) return Number.MAX_SAFE_INTEGER;
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function osrsRunEnergyClient(client: OsrsClient): RunEnergyClient {
    const facade = new ClientImpl(client);
    return {
        getEnergy: () => facade.getEnergy(),
        getBoostedSkillLevel: (skill) => facade.getBoostedSkillLevel(skill),
        getVarbitValue: (id) => facade.getVarbitValue(id),
        getLocalPlayer: () => facade.getLocalPlayer(),
        getWeight: () => client.cs2Vm?.context?.getWeight?.() ?? 0,
        getWornItems: () => client.equipment.getSlots().map((slot) => slot.itemId),
        hasDestination: () => ClientState.destinationX !== 0 || ClientState.destinationY !== 0,
        isMouseOverRunOrb: () => {
            const bounds = orbBounds(client, OrbComponent.RUNBUTTON);
            const x = Number(client.inputManager?.mouseX), y = Number(client.inputManager?.mouseY);
            if (!bounds || bounds.x <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) return false;
            return x >= bounds.x && x < bounds.x + bounds.w && y >= bounds.y && y < bounds.y + bounds.h;
        },
        getAccount: () => String(client.localPlayerName || "").trim().toLowerCase(),
        sendChatMessage: (message) => client.addGameMessage(message),
        setRunOrbText: (text) => {
            for (const widget of orbWidgets(client, OrbComponent.RUNENERGY_TEXT)) {
                if (widget.text === text) continue;
                widget.text = text;
                client.widgetManager.invalidateWidgetRender(widget);
            }
        },
    };
}
