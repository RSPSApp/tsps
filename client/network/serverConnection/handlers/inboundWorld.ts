import { ClientState } from "../../../game/ClientState";
import { sampleBridgeHeightForWorldTile, sampleCameraHeightForWorldTile } from "../../../game/scene/BridgeHeightSampler";
import { interactionModes } from "../../../game/InteractionModes";
import {
    VARP_AREA_SOUNDS_VOLUME,
    VARP_COMBAT_TARGET_PLAYER_INDEX,
    VARP_FOLLOWER_INDEX,
    VARP_MASTER_VOLUME,
    VARP_MUSIC_VOLUME,
    VARP_OPTION_ATTACK_PRIORITY_NPC,
    VARP_OPTION_ATTACK_PRIORITY_PLAYER,
    VARP_SOUND_EFFECTS_VOLUME,
} from "../../../common/vars";
import { send } from "../connection/send";
import { emitCollectionLog, emitInventory } from "../domain/inventory";
import { handleShopPayload } from "../domain/shop";
import { handleSmithingPayload } from "../domain/smithing";
import { emitPlayerSync, emitSkills } from "../domain/skills";
import { handleTradePayload } from "../domain/trade";
import { getClientCycle } from "../timing";
import { cloneRunEnergyState, state } from "../state";
import {
    BANK_SLOT_COUNT_FALLBACK,
    DEFAULT_SERVER_TICK_MS,
    RUN_ENERGY_MAX_UNITS,
} from "../constants";
import type {
    BankServerUpdate,
    ChatMessageEvent,
    GroundItemsServerPayload,
    NotificationEvent,
    RunEnergyPayload,
    RunEnergyState,
    ShopServerPayload,
    SmithingServerPayload,
    SkillsServerPayload,
    SpotAnimationPayload,
    TradeServerPayload,
} from "../types";
import type { WidgetServerPayload } from "../types/widgets";
import { decodeBase64 } from "../utils/decodeBase64";
import { applyGroundItemsDelta, cloneGroundItemsPayload } from "../utils/groundItems";
import { sanitizeBankSlotMessage, sanitizeInventorySlotMessage, sanitizeSpellResult } from "../utils/sanitize";

export function handleInboundWorld(msg: any): boolean {
    if (msg.type === "player_option") {
        const { slot, option, priority } = msg.payload;
        if (Number.isInteger(slot) && slot >= 1 && slot <= 8) {
            if (option) ClientState.playerOptions.set(slot, { option, priority });
            else ClientState.playerOptions.delete(slot);
            for (const listener of ClientState.playerOptionsChangedListeners) listener(slot - 1);
        }
        return true;
    }
    if (msg.type === "set_interaction_mode") {
        const { worldId, tileMode, entityMode } = msg.payload;
        interactionModes.set(worldId, tileMode, entityMode);
        return true;
    }
    if (msg.type === "reset_interaction_mode") {
        interactionModes.reset(msg.payload.worldId);
        return true;
    }
    if (msg.type === "region_replacement") {
        try {
            const client = ((typeof window !== "undefined" ? window : globalThis) as any)
                .__osrsClient;
            client?.onRegionReplacement?.(msg.payload);
        } catch (err) {
            console.warn("region_replacement handler error", err);
        }
        return true;
    }
    if (msg.type === "camera") {
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const client = g?.__osrsClient;
            const payload = msg.payload;
            if (!client?.camera || !payload) return true;
            // cam_target: the camera follows a tile or another player (spectating) until cam_reset.
            if (payload.mode === "target") {
                client.cameraTarget = Number.isInteger(payload.player)
                    ? { playerServerId: payload.player }
                    : { x: payload.x | 0, y: payload.y | 0, level: payload.level | 0 };
                client.followPlayerCamera = true;
                client.camera.clearScriptedCamera();
                return true;
            }
            if (payload.mode === "reset") {
                client.cameraTarget = undefined;
                client.followPlayerCamera = true;
                client.camera.clearScriptedCamera();
                client.camera.setScenePitchOverride(undefined);
                client.camera.setViewPitchOverride(undefined);
                client.renderer?.clearCameraShake?.();
                return true;
            }
            if (payload.mode === "unlock") {
                client.camera.setScriptedPitchUnlocked(payload.unlock === true);
                return true;
            }
            if (payload.mode === "translate") {
                client.camera.translateScriptedCamera(payload.dx, payload.dy);
                return true;
            }
            // cam_moveto_arc: a timed move that swings around a centre tile instead of a straight line.
            if (payload.mode === "arc") {
                client.followPlayerCamera = false;
                const packetHeight = client.camera.resolveScriptedHeight("move", payload.height, false);
                const controlledIndex = client.playerEcs?.getIndexForServerId?.(client.controlledPlayerServerId) ?? 0;
                const plane = client.playerEcs?.getLevel?.(controlledIndex) ?? 0;
                const heightAt = (targetX: number, targetZ: number): number | undefined => {
                    const ground = client.renderer?.mapManager
                        ? sampleCameraHeightForWorldTile(client.renderer.mapManager, targetX, targetZ, plane)
                        : undefined;
                    return ground === undefined ? undefined : ground - packetHeight / 128;
                };
                client.camera.setScriptedPositionArc(payload.centreX + 0.5, payload.centreY + 0.5, payload.x + 0.5, payload.y + 0.5,
                    payload.cycles, payload.easing, heightAt, packetHeight, payload.ignoreTerrain === true);
                return true;
            }
            if (payload.mode === "rotate") {
                client.camera.rotateScriptedBy(payload.pitch, payload.yaw, payload.cycles, payload.easing);
                return true;
            }
            // Camera packets carry global tile coordinates and height above that tile's
            // ground, in 1/128-tile units. Both movement and look target tile centres.
            if (payload.mode === "move" || payload.mode === "look") {
                const x = (Number(payload.x) || 0) + 0.5;
                const z = (Number(payload.y) || 0) + 0.5;
                const capturedRates = Number.isInteger(payload.rate) && Number.isInteger(payload.rate2);
                client.followPlayerCamera = false;
                const capturedCycles = Number.isInteger(payload.cycles) && payload.cycles > 0;
                if (capturedRates || capturedCycles) {
                    const packetHeight = client.camera.resolveScriptedHeight(payload.mode, payload.height, payload.heightRelative === true);
                    const heightAt = (targetX: number, targetZ: number): number | undefined => {
                        const controlledIndex = client.playerEcs?.getIndexForServerId?.(client.controlledPlayerServerId) ?? 0;
                        const plane = client.playerEcs?.getLevel?.(controlledIndex) ?? 0;
                        const ground = client.renderer?.mapManager
                            ? sampleCameraHeightForWorldTile(client.renderer.mapManager, targetX, targetZ, plane)
                            : undefined;
                        return ground === undefined ? undefined : ground - packetHeight / 128;
                    };
                    if (capturedCycles) {
                        if (payload.mode === "move") client.camera.setScriptedPositionCycles(x, z, payload.cycles, payload.easing, payload.ignoreTerrain === true, heightAt, packetHeight);
                        else client.camera.setScriptedLookCycles(x, z, payload.cycles, payload.easing, payload.trackTarget === true, heightAt);
                    }
                    else if (payload.mode === "move") client.camera.setScriptedPosition(x, 0, z, payload.rate, payload.rate2, heightAt);
                    else client.camera.setScriptedLook(x, 0, z, payload.rate, payload.rate2, heightAt);
                    return true;
                }
                const controlledIndex = client.playerEcs?.getIndexForServerId?.(client.controlledPlayerServerId) ?? 0;
                const plane = client.playerEcs?.getLevel?.(controlledIndex) ?? 0;
                const ground = client.renderer?.mapManager
                    ? sampleBridgeHeightForWorldTile(client.renderer.mapManager, x, z, plane)
                    : undefined;
                const height = (ground?.valid ? ground.height : 0) - (Number(payload.height) || 0) / 128;
                client.camera.clearScriptedCamera();
                // A first-person view override must not hide a scripted scene angle.
                client.camera.setViewPitchOverride(undefined);
                if (payload.mode === "move") {
                    if (payload.instant) {
                        client.camera.snapToPosition(x, height, z);
                    } else {
                        client.camera.setTargetPosition(x, height, z);
                    }
                    return true;
                }
                const dx = x - client.camera.getPosX();
                const dz = z - client.camera.getPosZ();
                const dy = height - client.camera.getPosY();
                const horizontal = Math.max(0.0001, Math.hypot(dx, dz));
                const yaw = Math.round(Math.atan2(dx, dz) * (2048 / (Math.PI * 2))) & 2047;
                const pitch = Math.round(Math.atan2(dy, horizontal) * (2048 / (Math.PI * 2)));
                // Packet angles are scene angles, whereas snapToPitch/setTargetPitch
                // accept the player's control range and remap it to 128..383.
                client.camera.setViewPitchOverride(pitch);
                if (payload.instant) {
                    client.camera.snapToYaw(yaw);
                } else {
                    client.camera.setTargetYaw(yaw);
                }
                return true;
            }
            if (payload.mode === "shake") {
                client.renderer?.setCameraShakeSlot?.(
                    payload.slot,
                    payload.randomAmplitude,
                    payload.sineAmplitude,
                    payload.sineFrequency,
                    0,
                );
                return true;
            }
        } catch (err) {
            console.warn("camera handler error", err);
        }
        return true;
    }
    if (msg.type === "loc_change") {
        const payload = msg.payload;
        try {
            // Notify osrs client to update the loc
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (mv && typeof mv.onLocChange === "function") {
                // Pass extended info for doors that move when opened
                mv.onLocChange(payload.oldId, payload.newId, payload.tile, payload.level, {
                    oldTile: payload.oldTile ?? payload.tile,
                    newTile: payload.newTile ?? payload.tile,
                    oldRotation: payload.oldRotation,
                    newRotation: payload.newRotation,
                    newShape: payload.newShape,
                });
            }
        } catch (err) {
            console.warn("loc_change handler error", err);
        }
        return true;
    }
    if (msg.type === "loc_add_change") {
        const payload = msg.payload;
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (mv && typeof mv.onLocAddChange === "function") {
                mv.onLocAddChange(
                    payload.locId,
                    payload.tile,
                    payload.level,
                    payload.shape,
                    payload.rotation,
                    payload.opFlags,
                );
            }
        } catch (err) {
            console.warn("loc_add_change handler error", err);
        }
        return true;
    }
    if (msg.type === "loc_del") {
        const payload = msg.payload;
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (mv && typeof mv.onLocDel === "function") {
                mv.onLocDel(payload.tile, payload.level, payload.shape, payload.rotation);
            }
        } catch (err) {
            console.warn("loc_del handler error", err);
        }
        return true;
    }
    if (msg.type === "loc_anim") {
        const payload = msg.payload;
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (mv && typeof mv.onLocAnim === "function") {
                mv.onLocAnim(
                    payload.locId,
                    payload.tile,
                    payload.level,
                    payload.shape,
                    payload.rotation,
                    payload.animId,
                );
            }
        } catch (err) {
            console.warn("loc_anim handler error", err);
        }
        return true;
    }
    if (msg.type === "vars") {
        const payload = msg.payload;
        try {
            // Update varps and varbits on the client's VarManager
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (mv && mv.varManager) {
                const vm = mv.varManager;
                // Apply varp updates
                if (payload.varps) {
                    for (const [id, value] of Object.entries(payload.varps)) {
                        vm.setServerVarp?.(Number(id), Number(value));
                    }
                }
                // Apply varbit updates
                if (payload.varbits) {
                    for (const [id, value] of Object.entries(payload.varbits)) {
                        vm.setServerVarbit?.(Number(id), Number(value));
                    }
                }
            }
        } catch (err) {
            console.warn("vars handler error", err);
        }
        return true;
    }
    if (msg.type === "sound") {
        for (const cb of state.soundListeners) {
            try {
                cb(msg.payload);
            } catch (err) {
                console.warn("sound listener error", err);
            }
        }
        return true;
    }
    if (msg.type === "play_song") {
        for (const cb of state.playSongListeners) {
            try {
                cb(msg.payload);
            } catch (err) {
                console.warn("play_song listener error", err);
            }
        }
        return true;
    }
    if (msg.type === "play_jingle") {
        for (const cb of state.playJingleListeners) {
            try {
                cb(msg.payload);
            } catch (err) {
                console.warn("play_jingle listener error", err);
            }
        }
        return true;
    }
    if (msg.type === "varp_long") {
        const mv: any = ((typeof window !== "undefined" ? window : globalThis) as any)?.__osrsClient;
        if (mv?.varManager) {
            const payload = msg.payload as { varpId: number; value: bigint };
            mv._serverVarpSync = true;
            try {
                mv.varManager.setServerVarpLong(payload.varpId | 0, payload.value);
            } finally {
                mv._serverVarpSync = false;
            }
        }
        return true;
    }
    if (msg.type === "varp") {
        // Server-pushed varp update
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (mv && mv.varManager) {
                const payload = msg.payload as { varpId: number; value: number };
                const varpId = payload.varpId | 0;
                const value = payload.value | 0;
                // Use _serverVarpSync flag to prevent sending back to server
                mv._serverVarpSync = true;
                try {
                    mv.varManager.setServerVarp?.(varpId, value);
                } finally {
                    mv._serverVarpSync = false;
                }

                // Apply audio volume when sound varps are received from server
                // CS2 scripts normally do this via enum_981 lookup, but they only run when settings tab opens
                // enum_981 provides a non-linear (quadratic) curve: enum_981(50) ≈ 23, enum_981(100) = 100
                // We approximate this curve here to match CS2 behavior
                const applyVolumeCurve = (v: number): number => {
                    // Quadratic curve: output = input^2 / 100
                    // This matches OSRS enum_981 non-linear volume scaling
                    return Math.round((v * v) / 100);
                };

                if (varpId === VARP_MUSIC_VOLUME) {
                    const curved = applyVolumeCurve(value);
                    const scaled = Math.round((curved * 255) / 100);
                    const vol = Math.max(0, Math.min(1, scaled / 255));
                    mv._musicVolume = vol;
                    mv.musicSystem?.setVolume?.(vol * (mv.masterVolume ?? 1));
                } else if (varpId === VARP_SOUND_EFFECTS_VOLUME) {
                    const curved = applyVolumeCurve(value);
                    const scaled = Math.round((curved * 127) / 100);
                    const vol = Math.max(0, Math.min(1, scaled / 127));
                    mv._sfxVolume = vol;
                    mv.soundEffectSystem?.setVolume?.(vol * (mv.masterVolume ?? 1));
                } else if (varpId === VARP_AREA_SOUNDS_VOLUME) {
                    const curved = applyVolumeCurve(value);
                    const scaled = Math.round((curved * 127) / 100);
                    const vol = Math.max(0, Math.min(1, scaled / 127));
                    mv._ambientVolume = vol;
                    mv.soundEffectSystem?.setAmbientVolume?.(vol * (mv.masterVolume ?? 1));
                } else if (varpId === VARP_MASTER_VOLUME) {
                    const curved = applyVolumeCurve(value);
                    const masterVol = Math.max(0, Math.min(1, curved / 100));
                    mv.masterVolume = masterVol;
                    mv.applyMasterVolume?.();
                }

                // Apply attack option varps to ClientState for menu building
                if (varpId === VARP_OPTION_ATTACK_PRIORITY_PLAYER) {
                    ClientState.playerAttackOption = Math.max(0, Math.min(4, value | 0));
                    console.log(
                        `[varp] Player attack option set to ${ClientState.playerAttackOption}`,
                    );
                } else if (varpId === VARP_OPTION_ATTACK_PRIORITY_NPC) {
                    ClientState.npcAttackOption = Math.max(0, Math.min(3, value | 0));
                    console.log(`[varp] NPC attack option set to ${ClientState.npcAttackOption}`);
                } else if (varpId === VARP_FOLLOWER_INDEX) {
                    const followerIndex = value & 0xffff;
                    ClientState.followerIndex = followerIndex === 65535 ? -1 : followerIndex;
                    console.log(`[varp] Follower index set to ${ClientState.followerIndex}`);
                } else if (varpId === VARP_COMBAT_TARGET_PLAYER_INDEX) {
                    ClientState.combatTargetPlayerIndex = value === -1 ? -1 : value & 0x7ff;
                    console.log(
                        `[varp] Combat target player index set to ${ClientState.combatTargetPlayerIndex}`,
                    );
                }
            }
        } catch (err) {
            console.warn("varp handler error", err);
        }
        return true;
    }
    if (msg.type === "varbit") {
        // Server-pushed varbit update
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (mv && mv.varManager) {
                const payload = msg.payload as { varbitId: number; value: number };
                // Use _serverVarpSync flag to prevent sending back to server
                mv._serverVarpSync = true;
                try {
                    const result = mv.varManager.setServerVarbit?.(
                        payload.varbitId | 0,
                        payload.value | 0,
                    );
                    if (result) {
                        // Trigger var transmit cycle so CS2 scripts with onVarTransmit will update
                        mv.updateVars?.();
                    }
                } finally {
                    mv._serverVarpSync = false;
                }
            }
        } catch (err) {
            console.warn("varbit handler error", err);
        }
        return true;
    }
    if (msg.type === "runClientScript") {
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            const payload = msg.payload as { scriptId: number; args: (number | string)[] };
            const scriptId = payload.scriptId | 0;
            const script = mv?.cs2Vm?.context?.loadScript?.(scriptId);
            if (script) {
                const intArgs: number[] = [];
                const stringArgs: string[] = [];
                for (const arg of payload.args || []) {
                    if (typeof arg === "number") intArgs.push(arg | 0);
                    else if (typeof arg === "string") stringArgs.push(arg);
                }
                mv.cs2Vm.run(script, intArgs, stringArgs);
            }
        } catch (err) {
            console.warn("runClientScript handler error", err);
        }
        return true;
    }
    if (msg.type === "if_settext") {
        // Server-pushed IF_SETTEXT - update widget text ()
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            const payload = msg.payload as { uid: number; text: string };
            if (mv && mv.widgetManager) {
                const widget = mv.widgetManager.getWidgetByUid(payload.uid | 0);
                if (widget) {
                    widget.text = payload.text ?? "";
                }
            }
        } catch (err) {
            console.warn("if_settext handler error", err);
        }
            return true;
    }
    return false;
}
