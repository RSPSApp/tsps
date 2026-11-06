package gateway.down

import gateway.coverage.DropCounter
import gateway.session.WorldEntities
import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import net.rsprot.protocol.game.outgoing.camera.CamLookAtCycles
import net.rsprot.protocol.game.outgoing.camera.CamLookAtV3
import net.rsprot.protocol.game.outgoing.camera.CamMoveToArcV3
import net.rsprot.protocol.game.outgoing.camera.CamMoveToCyclesV3
import net.rsprot.protocol.game.outgoing.camera.CamMoveToV3
import net.rsprot.protocol.game.outgoing.camera.CamReset
import net.rsprot.protocol.game.outgoing.camera.CamRotateBy
import net.rsprot.protocol.game.outgoing.camera.CamShake
import net.rsprot.protocol.game.outgoing.camera.CamTargetV4
import net.rsprot.protocol.game.outgoing.camera.CamUnlock
import net.rsprot.protocol.game.outgoing.misc.client.HintArrow
import net.rsprot.protocol.game.outgoing.misc.client.ResetInteractionMode
import net.rsprot.protocol.game.outgoing.misc.client.SetInteractionMode
import net.rsprot.protocol.game.outgoing.misc.client.UpdateRebootTimerV2
import net.rsprot.protocol.game.outgoing.sound.MidiJingle
import net.rsprot.protocol.game.outgoing.sound.MidiSongV2
import net.rsprot.protocol.game.outgoing.sound.SynthSound
import net.rsprot.protocol.game.outgoing.specific.LocAnimSpecific
import net.rsprot.protocol.game.outgoing.specific.MapAnimSpecific
import net.rsprot.protocol.game.outgoing.specific.ProjAnimSpecificV4
import net.rsprot.protocol.api.util.ZonePartialEnclosedCacheBuffer
import net.rsprot.protocol.common.client.OldSchoolClientType
import net.rsprot.protocol.game.outgoing.zone.header.UpdateZonePartialEnclosed
import net.rsprot.protocol.message.ZoneProt
import net.rsprot.protocol.game.outgoing.zone.payload.LocAddChangeV2
import net.rsprot.protocol.game.outgoing.zone.payload.LocAnim
import net.rsprot.protocol.game.outgoing.zone.payload.LocDel
import net.rsprot.protocol.game.outgoing.zone.payload.SoundArea
import net.rsprot.protocol.message.OutgoingGameMessage
import net.rsprot.protocol.internal.game.outgoing.info.CoordGrid

/**
 * The world around the player: locs, tile effects, sound, music, camera and hints.
 *
 * tsps sends loc changes and area sounds with absolute tiles; OSRS puts them in a zone, so
 * they're gathered per zone of the build area and sent enclosed at the end of the tick.
 */
class World(
    private val send: (OutgoingGameMessage) -> Unit,
    /** The boat deck a tile is on: its updates go to that boat's world, relative to the deck. */
    private val deckAt: (Int, Int) -> WorldEntities.Deck? = { _, _ -> null },
    /** The session's world id for a boat tsps names by its index (3000+), or null. */
    private val boatWorld: (Int) -> Int? = { null },
) {
    private var sceneX = 0
    private var sceneZ = 0

    /** This tick's zone payloads, by zone; revision 241 only takes some of them enclosed. */
    private val pending = LinkedHashMap<Triple<Int, Int, Int>, MutableList<ZoneProt>>()

    /** Boat decks' zone payloads, by boat, kept until the client has that boat's world. */
    private val pendingDecks = HashMap<Int, LinkedHashMap<Triple<Int, Int, Int>, MutableList<ZoneProt>>>()
    private val zoneBuffers = ZonePartialEnclosedCacheBuffer(listOf(OldSchoolClientType.DESKTOP))

    /** Sends this tick's zone updates, one UPDATE_ZONE_PARTIAL_ENCLOSED per zone. */
    fun flushZones() {
        flush(pending)
    }

    /** Sends a boat's deck updates; the boat's world must be the active one. */
    fun flushDeck(worldId: Int) {
        pendingDecks.remove(worldId)?.let(::flush)
    }

    /** The client no longer has this boat. */
    fun dropDeck(worldId: Int) {
        pendingDecks.remove(worldId)
    }

    private fun flush(zones: MutableMap<Triple<Int, Int, Int>, MutableList<ZoneProt>>) {
        for ((zone, payloads) in zones) {
            val (zoneX, zoneZ, level) = zone
            val payload = zoneBuffers.computeZoneForClient(OldSchoolClientType.DESKTOP, payloads)
            send(UpdateZonePartialEnclosed(zoneX, zoneZ, level, payload))
        }
        zones.clear()
        zoneBuffers.releaseBuffers()
    }

    fun rebuild(zoneX: Int, zoneZ: Int) {
        // Updates for the old scene would land on the wrong zones of the new one.
        pending.clear()
        sceneX = (zoneX - SCENE_RADIUS_ZONES) shl 3
        sceneZ = (zoneZ - SCENE_RADIUS_ZONES) shl 3
    }

    fun handle(packet: TspsPacket): Boolean {
        val reader = packet.reader()
        when (packet.opcode) {
            TspsServerPacket.LOC_ADD_CHANGE -> {
                val id = reader.u16()
                val x = reader.u16()
                val z = reader.u16()
                val level = reader.u8()
                val shapeRotation = reader.u8()
                val ops = if (reader.remaining > 0) reader.u8().toByte() else ALL_OPS
                zone(x, z, level, LocAddChangeV2(id, x and 7, z and 7, shapeRotation ushr 2, shapeRotation and 3, ops))
            }
            TspsServerPacket.LOC_DEL -> {
                val x = reader.u16()
                val z = reader.u16()
                val level = reader.u8()
                val shapeRotation = reader.u8()
                zone(x, z, level, LocDel(x and 7, z and 7, shapeRotation ushr 2, shapeRotation and 3))
            }
            TspsServerPacket.LOC_ANIM -> {
                reader.u16() // loc id: the client animates whatever is on the tile
                val x = reader.u16()
                val z = reader.u16()
                val level = reader.u8()
                val shapeRotation = reader.u8()
                val anim = reader.u16()
                when {
                    // A boat's sails and helm: in that boat's world, as its locs are.
                    deckAt(x, z) != null -> zone(x, z, level, LocAnim(anim, x and 7, z and 7, shapeRotation ushr 2, shapeRotation and 3))
                    inScene(x, z) -> send(LocAnimSpecific(anim, x - sceneX, z - sceneZ, shapeRotation ushr 2, shapeRotation and 3))
                }
            }
            TspsServerPacket.SPOT_ANIM -> {
                val id = reader.u16()
                if (reader.u8() != TILE_TARGET) {
                    DropCounter.down(packet.opcode)
                } else {
                    val x = reader.u16()
                    val z = reader.u16()
                    reader.u8()
                    val height = reader.u8()
                    val delay = reader.u16()
                    if (inScene(x, z)) send(MapAnimSpecific(id, delay, height, x - sceneX, z - sceneZ))
                }
            }
            TspsServerPacket.SOUND -> {
                val id = reader.u16()
                val positioned = reader.u8() != 0
                val x = if (positioned) reader.u16() else 0
                val z = if (positioned) reader.u16() else 0
                val level = if (positioned) reader.u8() else 0
                val loops = reader.u8()
                val delay = reader.u16()
                val radius = reader.u8()
                val attenuation = reader.u8()
                if (positioned) {
                    zone(x, z, level, SoundArea(id, delay.coerceAtMost(MAX_BYTE), loops, radius, attenuation, x and 7, z and 7))
                } else {
                    send(SynthSound(id, loops, delay))
                }
            }
            TspsServerPacket.PLAY_JINGLE -> send(MidiJingle(reader.u16()))
            TspsServerPacket.PLAY_SONG -> send(MidiSongV2(reader.u16(), reader.u16(), reader.u16(), reader.u16(), reader.u16()))
            TspsServerPacket.HINT_ARROW -> {
                val type = reader.u8()
                val a = reader.u16()
                val b = reader.u16()
                val c = reader.u8()
                val d = reader.u8()
                send(
                    HintArrow(
                        when (type) {
                            HINT_NPC -> HintArrow.NpcHintArrow(a)
                            HINT_TILE -> HintArrow.TileHintArrow(a, b, c, (d ushr 2) and 7)
                            HINT_PLAYER -> HintArrow.PlayerHintArrow(a)
                            HINT_WORLD_ENTITY -> boatWorld(a)?.let { HintArrow.WorldEntityHintArrow(it, c) } ?: HintArrow.ResetHintArrow
                            else -> HintArrow.ResetHintArrow
                        },
                    ),
                )
            }
            TspsServerPacket.SET_INTERACTION_MODE -> {
                val world = world(reader.s16())
                val tiles = reader.u8()
                val entities = reader.u8()
                if (world != null) send(SetInteractionMode(world, tiles, entities)) else DropCounter.down(packet.opcode)
            }
            TspsServerPacket.RESET_INTERACTION_MODE ->
                world(reader.s16())?.let { send(ResetInteractionMode(it)) } ?: DropCounter.down(packet.opcode)
            TspsServerPacket.SYSTEM_UPDATE -> {
                val centis = reader.i32()
                send(UpdateRebootTimerV2(centis / CENTIS_PER_TICK, UpdateRebootTimerV2.IgnoreUpdateMessage))
            }
            TspsServerPacket.CAMERA_CONTROL -> camera(packet)
            TspsServerPacket.PROJECTILES -> repeat(reader.u16()) { projectile(reader) }
            else -> return false
        }
        return true
    }

    /** CAMERA_CONTROL: a sub-type byte, then that camera command (ClientProtocol.ts `encodeCamera*`). */
    private fun camera(packet: TspsPacket) {
        val reader = packet.reader()
        when (val sub = reader.u8()) {
            CAM_RESET -> send(CamReset)
            CAM_MOVE_TO, CAM_LOOK_AT -> {
                val x = reader.u16()
                val z = reader.u16()
                val height = reader.s16()
                val animated = reader.u8() != 0
                val (rate, rate2) = if (animated) ANIMATED_RATES else INSTANT_RATES
                send(if (sub == CAM_MOVE_TO) CamMoveToV3(x, z, height, rate, rate2, false) else CamLookAtV3(x, z, height, rate, rate2, false))
            }
            CAM_MOVE_TO + CAPTURED, CAM_LOOK_AT + CAPTURED -> {
                val x = reader.u16()
                val z = reader.u16()
                val height = reader.s16()
                val rate = reader.u8()
                val rate2 = reader.u8()
                val relative = reader.u8() and 1 != 0
                send(if (sub == CAM_MOVE_TO + CAPTURED) CamMoveToV3(x, z, height, rate, rate2, relative) else CamLookAtV3(x, z, height, rate, rate2, relative))
            }
            CAM_MOVE_TO + TIMED, CAM_LOOK_AT + TIMED -> {
                val x = reader.u16()
                val z = reader.u16()
                val height = reader.s16()
                val cycles = reader.u16()
                val easing = EASINGS[reader.u8()]
                val flags = reader.u8()
                val relative = flags and 1 != 0
                // tsps's trackTarget flag (4) has no OSRS form.
                send(
                    if (sub == CAM_MOVE_TO + TIMED) {
                        CamMoveToCyclesV3(x, z, height, cycles, flags and 2 != 0, easing, relative)
                    } else {
                        CamLookAtCycles(x, z, height, cycles, easing, relative)
                    },
                )
            }
            CAM_SHAKE -> send(CamShake(reader.u8(), reader.u16().coerceAtMost(MAX_BYTE), reader.u16().coerceAtMost(MAX_BYTE), reader.u16().coerceAtMost(MAX_BYTE)))
            CAM_UNLOCK -> send(CamUnlock(reader.u8() != 0))
            CAM_ROTATE_BY -> send(CamRotateBy(reader.s16(), reader.s16(), reader.u16(), EASINGS[reader.u8()]))
            CAM_ARC -> {
                val centreX = reader.u16()
                val centreZ = reader.u16()
                val x = reader.u16()
                val z = reader.u16()
                val height = reader.s16()
                val cycles = reader.u16()
                val easing = EASINGS[reader.u8()]
                val flags = reader.u8()
                send(CamMoveToArcV3(centreX, centreZ, x, z, height, cycles, flags and 2 != 0, easing, false))
            }
            CAM_TARGET -> {
                when (reader.u8()) {
                    TARGET_TILE -> send(CamTargetV4(CamTargetV4.CoordGridTarget(tile(reader))))
                    TARGET_PLAYER -> send(CamTargetV4(CamTargetV4.PlayerCamTarget(reader.u16())))
                    TARGET_NPC -> send(CamTargetV4(CamTargetV4.NpcCamTarget(reader.u16())))
                    TARGET_WORLD_ENTITY ->
                        boatWorld(reader.u16())?.let { send(CamTargetV4(CamTargetV4.WorldEntityTarget(it))) } ?: DropCounter.down(packet.opcode)
                    // A tile glide has no OSRS form; the target tile is the nearest thing.
                    else -> send(CamTargetV4(CamTargetV4.CoordGridTarget(tile(reader))))
                }
            }
            else -> DropCounter.down(TspsServerPacket.CAMERA_CONTROL)
        }
    }

    /** One `encodeProjectiles` entry: absolute tiles, heights already ×4, cycles, and the actors it's locked to. */
    private fun projectile(reader: gateway.tsps.TspsReader) {
        val id = reader.u16()
        val startX = reader.u16()
        val startZ = reader.u16()
        val startLevel = reader.u8()
        val startHeight = reader.u16()
        val endX = reader.u16()
        val endZ = reader.u16()
        val endLevel = reader.u8()
        val endHeight = reader.u16()
        val slope = reader.u8()
        val progress = reader.u16()
        val startCycle = reader.u16()
        val endCycle = reader.u16()
        val source = actor(reader.u8(), reader.u16())
        val target = actor(reader.u8(), reader.u16())
        send(
            ProjAnimSpecificV4(
                id, startHeight, endHeight, startCycle, endCycle, slope, progress,
                startX, startZ, startLevel, source, endX, endZ, endLevel, target,
            ),
        )
    }

    /** rsprot's actor lock: a player is -(index + 1), an NPC index + 1, nothing 0. */
    private fun actor(kind: Int, index: Int) =
        when (kind) {
            ACTOR_PLAYER -> -(index + 1)
            ACTOR_NPC -> index + 1
            else -> 0
        }

    private fun tile(reader: gateway.tsps.TspsReader): CoordGrid {
        val x = reader.u16()
        val z = reader.u16()
        return CoordGrid(reader.u8() and 3, x, z)
    }

    /**
     * A world id tsps names: negative ones (the root world, the current one) are the client's
     * own; a boat is renumbered to the session's world for it, or null when the client hasn't it.
     */
    private fun world(id: Int): Int? = if (id < 0) id else boatWorld(id)

    private fun zone(x: Int, z: Int, level: Int, payload: ZoneProt) {
        val deck = deckAt(x, z)
        if (deck != null) {
            val zones = pendingDecks.getOrPut(deck.worldId) { LinkedHashMap() }
            zones.getOrPut(Triple((x - deck.baseX) and 7.inv(), (z - deck.baseZ) and 7.inv(), level)) { ArrayList() } += payload
            return
        }
        if (!inScene(x, z)) return
        pending.getOrPut(Triple((x - sceneX) and 7.inv(), (z - sceneZ) and 7.inv(), level)) { ArrayList() } += payload
    }

    private fun inScene(x: Int, z: Int) = x - sceneX in 0 until SCENE_SIZE && z - sceneZ in 0 until SCENE_SIZE

    private companion object {
        const val SCENE_RADIUS_ZONES = 6
        const val SCENE_SIZE = 104
        const val ALL_OPS: Byte = 0x1F
        const val MAX_BYTE = 255
        const val TILE_TARGET = 2
        const val CENTIS_PER_TICK = 60

        const val ACTOR_PLAYER = 1
        const val ACTOR_NPC = 2

        const val HINT_NPC = 1
        const val HINT_TILE = 2
        const val HINT_PLAYER = 3
        const val HINT_WORLD_ENTITY = 4

        const val CAM_RESET = 0
        const val CAM_MOVE_TO = 1
        const val CAM_LOOK_AT = 2
        const val CAM_SHAKE = 3
        const val CAPTURED = 3
        const val CAM_UNLOCK = 6
        const val TIMED = 7
        const val CAM_ROTATE_BY = 10
        const val CAM_ARC = 11
        const val CAM_TARGET = 12
        const val TARGET_TILE = 0
        const val TARGET_PLAYER = 1
        const val TARGET_NPC = 2
        const val TARGET_WORLD_ENTITY = 3

        /** OSRS's camera rates: 100+ snaps; tsps's plain "animated" uses a gentle default. */
        val INSTANT_RATES = 100 to 100
        val ANIMATED_RATES = 2 to 10

        /** tsps's CAMERA_EASINGS order (linear, ease in-out sine, ease out cubic, ease out sine, ease in sine) as OSRS easing ids. */
        val EASINGS = intArrayOf(0, 3, 8, 2, 1)
    }
}
