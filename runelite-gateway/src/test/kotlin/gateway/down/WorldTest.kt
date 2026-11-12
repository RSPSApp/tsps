package gateway.down

import gateway.session.WorldEntities
import gateway.headless.HeadlessClient
import gateway.headless.TestCache
import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import io.netty.buffer.Unpooled
import net.rsprot.buffer.extensions.toJagByteBuf
import net.rsprot.compression.HuffmanCodec
import net.rsprot.crypto.cipher.NopStreamCipher
import net.rsprot.protocol.game.outgoing.codec.specific.ObjEnabledOpsSpecificEncoder
import net.rsprot.protocol.game.outgoing.camera.CamMoveToCyclesV3
import net.rsprot.protocol.game.outgoing.camera.CamRotateToCoordinateV3
import net.rsprot.protocol.game.outgoing.camera.CamSkybox
import net.rsprot.protocol.game.outgoing.camera.util.CameraEaseFunction
import net.rsprot.protocol.game.outgoing.misc.client.HideNpcOps
import net.rsprot.protocol.game.outgoing.misc.client.HideObjOps
import net.rsprot.protocol.game.outgoing.misc.client.HintArrow
import net.rsprot.protocol.game.outgoing.sound.SynthSound
import net.rsprot.protocol.game.outgoing.specific.ProjAnimSpecificV4
import net.rsprot.protocol.game.outgoing.misc.client.SetInteractionMode
import net.rsprot.protocol.game.outgoing.specific.LocAnimSpecific
import net.rsprot.protocol.game.outgoing.specific.ObjAddSpecific
import net.rsprot.protocol.game.outgoing.specific.ObjCountSpecific
import net.rsprot.protocol.game.outgoing.specific.ObjDelSpecific
import net.rsprot.protocol.game.outgoing.specific.ObjEnabledOpsSpecific
import net.rsprot.protocol.game.outgoing.zone.header.UpdateZoneFullFollows
import net.rsprot.protocol.game.outgoing.zone.header.UpdateZonePartialEnclosed
import net.rsprot.protocol.message.OutgoingGameMessage
import net.rsprox.cache.api.CacheProvider
import net.rsprox.protocol.session.AttributeMap
import net.rsprox.protocol.session.Session
import net.rsprox.protocol.v242.ServerPacketDecoderServiceV242
import net.rsprox.protocol.game.outgoing.model.specific.ObjEnabledOpsSpecific as DecodedObjEnabledOpsSpecific
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** tsps world packets, built as ClientProtocol.ts builds them, through [World]. */
class WorldTest {
    private val sent = ArrayList<OutgoingGameMessage>()
    private val world = World({ sent += it }).apply { rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z) }

    @Test
    fun `a loc change goes behind its zone in the build area`() {
        val x = 3222
        val z = 3218
        world.handle(packet(TspsServerPacket.LOC_ADD_CHANGE, TspsWriter().u16(DOOR).u16(x).u16(z).u8(0).u8((0 shl 2) or 1)))
        // Zone updates wait for the end of the tick, then go one enclosed packet per zone.
        assertTrue(sent.isEmpty())
        world.flushZones()
        val zone = sent.single() as UpdateZonePartialEnclosed
        val sceneX = (LUMBRIDGE_ZONE_X - 6) shl 3
        val sceneZ = (LUMBRIDGE_ZONE_Z - 6) shl 3
        assertEquals((x - sceneX) and 7.inv(), zone.zoneX)
        assertEquals((z - sceneZ) and 7.inv(), zone.zoneZ)
        assertTrue(zone.payload.readableBytes() > 0)
    }

    @Test
    fun `an instance rebuild resets the zones loc changes went to, so tsps's replay is all that stays`() {
        // A POH chair (shape 10) then its removal: tsps rebuilds the house in place and no longer sends the chair.
        val x = 3222
        val z = 3218
        world.handle(packet(TspsServerPacket.LOC_ADD_CHANGE, TspsWriter().u16(DOOR).u16(x).u16(z).u8(1).u8(10 shl 2)))
        world.handle(packet(TspsServerPacket.LOC_DEL, TspsWriter().u16(x + 8).u16(z).u8(0).u8(10 shl 2)))
        world.flushZones()
        sent.clear()

        world.rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z, replayed = true)
        val sceneX = (LUMBRIDGE_ZONE_X - 6) shl 3
        val sceneZ = (LUMBRIDGE_ZONE_Z - 6) shl 3
        val resets = sent.map { it as UpdateZoneFullFollows }.map { Triple(it.zoneX, it.zoneZ, it.level) }.toSet()
        assertEquals(
            setOf(
                Triple((x - sceneX) and 7.inv(), (z - sceneZ) and 7.inv(), 1),
                Triple((x + 8 - sceneX) and 7.inv(), (z - sceneZ) and 7.inv(), 0),
            ),
            resets,
        )

        // Reset once: the next rebuild only resets what was sent since.
        sent.clear()
        world.rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z, replayed = true)
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `loc changes a second rebuild in the tick dropped before they went out need no reset`() {
        // Entering a house and ::maxhouse rebuild it twice in one tick; the first replay never reaches the client.
        world.handle(packet(TspsServerPacket.LOC_ADD_CHANGE, TspsWriter().u16(DOOR).u16(3222).u16(3218).u8(1).u8(10 shl 2)))
        world.rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z, replayed = true)
        world.flushZones()
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `a static rebuild resets nothing, and zones the new scene drops are forgotten`() {
        world.handle(packet(TspsServerPacket.LOC_ADD_CHANGE, TspsWriter().u16(DOOR).u16(3222).u16(3218).u8(0).u8(10 shl 2)))
        world.flushZones()
        sent.clear()
        world.rebuild(LUMBRIDGE_ZONE_X + 1, LUMBRIDGE_ZONE_Z)
        assertTrue(sent.isEmpty(), "REBUILD_NORMAL: tsps doesn't replay, the client's own locs stay")
        // Far away: the client discarded the loc change, so there is nothing to reset on the way back.
        world.rebuild(LUMBRIDGE_ZONE_X + 40, LUMBRIDGE_ZONE_Z)
        world.rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z, replayed = true)
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `a loc on a boat's deck waits for the boat's world, relative to the deck`() {
        val deck = WorldEntities.Deck(BOAT, WORLD, 1, 1, 1, DECK_ZONE, DECK_ZONE, arrayOfNulls(4 * 13 * 13))
        val boats = World({ sent += it }, deckAt = { x, z -> deck.takeIf { it.contains(x, z) } }).apply { rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z) }
        val x = (DECK_ZONE shl 3) + 3
        val z = (DECK_ZONE shl 3) + 5
        boats.handle(packet(TspsServerPacket.LOC_ADD_CHANGE, TspsWriter().u16(DOOR).u16(x).u16(z).u8(1).u8((10 shl 2) or 0)))
        boats.flushZones()
        assertTrue(sent.isEmpty(), "not in the main world's zones")
        boats.flushDeck(WORLD)
        val zone = sent.single() as UpdateZonePartialEnclosed
        assertEquals(Triple(0, 0, 1), Triple(zone.zoneX, zone.zoneZ, zone.level))
    }

    @Test
    fun `a deck loc's animation (sails, helm) goes to the boat's world, a root one straight out`() {
        val deck = WorldEntities.Deck(BOAT, WORLD, 1, 1, 1, DECK_ZONE, DECK_ZONE, arrayOfNulls(4 * 13 * 13))
        val boats = World({ sent += it }, deckAt = { x, z -> deck.takeIf { it.contains(x, z) } }).apply { rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z) }
        // SailingContent.animateDeckLoc's LOC_ANIM: u16 loc, x, z, u8 level, shape << 2 | rotation, u16 anim.
        boats.handle(packet(TspsServerPacket.LOC_ANIM, TspsWriter().u16(DOOR).u16((DECK_ZONE shl 3) + 3).u16((DECK_ZONE shl 3) + 5).u8(1).u8(10 shl 2).u16(ANIM)))
        boats.flushZones()
        assertTrue(sent.isEmpty(), "not in the main world")
        boats.flushDeck(WORLD)
        val zone = sent.removeAt(0) as UpdateZonePartialEnclosed
        assertEquals(Triple(0, 0, 1), Triple(zone.zoneX, zone.zoneZ, zone.level))
        assertTrue(zone.payload.readableBytes() > 0)

        boats.handle(packet(TspsServerPacket.LOC_ANIM, TspsWriter().u16(DOOR).u16(3222).u16(3218).u8(0).u8(0).u16(ANIM)))
        assertEquals(ANIM, (sent.single() as LocAnimSpecific).id)
    }

    @Test
    fun `a boat's interaction mode names the session's world for it`() {
        val boats = World({ sent += it }, boatWorld = { index -> if (index == BOAT) WORLD else null })
        boats.handle(packet(TspsServerPacket.SET_INTERACTION_MODE, TspsWriter().u16(BOAT).u8(1).u8(1)))
        boats.handle(packet(TspsServerPacket.SET_INTERACTION_MODE, TspsWriter().u16(0xFFFE).u8(2).u8(1)))
        boats.handle(packet(TspsServerPacket.SET_INTERACTION_MODE, TspsWriter().u16(3999).u8(1).u8(1)))
        // tsps's 3000+ would be out of the client's range; -2 is the client's own; an unknown boat is dropped.
        assertEquals(listOf(WORLD, -2), sent.map { (it as SetInteractionMode).worldId })
    }

    @Test
    fun `hide npc ops maps its global boolean to the native packet`() {
        world.handle(packet(TspsServerPacket.HIDE_NPC_OPS, TspsWriter().u8(1)))
        world.handle(packet(TspsServerPacket.HIDE_NPC_OPS, TspsWriter().u8(0)))
        assertEquals(listOf(true, false), sent.map { (it as HideNpcOps).hidden })
    }

    @Test
    fun `hide obj ops maps its global boolean to the native ground-item packet`() {
        world.handle(packet(TspsServerPacket.HIDE_OBJ_OPS, TspsWriter().u8(1)))
        world.handle(packet(TspsServerPacket.HIDE_OBJ_OPS, TspsWriter().u8(0)))
        assertEquals(listOf(true, false), sent.map { (it as HideObjOps).hidden })
    }

    @Test
    fun `sounds are area sounds with a tile and synth sounds without one`() {
        world.handle(packet(TspsServerPacket.SOUND, TspsWriter().u16(SOUND).u8(1).u16(3222).u16(3218).u8(0).u8(1).u16(0).u8(5).u8(0)))
        world.handle(packet(TspsServerPacket.SOUND, TspsWriter().u16(SOUND).u8(0).u8(1).u16(0).u8(0).u8(0)))
        assertEquals(SOUND, (sent.single() as SynthSound).id)
        // Revisions 241 and 242 only take SOUND_AREA inside an enclosed zone update.
        world.flushZones()
        assertTrue(sent.last() is UpdateZonePartialEnclosed)
    }

    @Test
    fun `timed camera moves and hint arrows map to their packets`() {
        world.handle(packet(TspsServerPacket.CAMERA_CONTROL, TspsWriter().u8(8).u16(3222).u16(3218).u16(400).u16(60).u8(2).u8(0)))
        val camera = sent.single() as CamMoveToCyclesV3
        assertEquals(60, camera.cycles)
        assertEquals(CameraEaseFunction.EASE_OUT_CUBIC, camera.easing)
        world.handle(packet(TspsServerPacket.HINT_ARROW, TspsWriter().u8(1).u16(NPC_INDEX).u16(0).u8(0).u8(0)))
        assertEquals(NPC_INDEX, ((sent.last() as HintArrow).type as HintArrow.NpcHintArrow).index)
    }

    @Test
    fun `cam_skybox carries the model and its explicit clear`() {
        world.handle(packet(TspsServerPacket.CAMERA_CONTROL, TspsWriter().u8(14).i32(61359)))
        world.handle(packet(TspsServerPacket.CAMERA_CONTROL, TspsWriter().u8(14).i32(-1)))
        assertEquals(listOf(61359, -1), sent.map { (it as CamSkybox).model })
    }

    @Test
    fun `coordinate rotations retain their distinct native angle tween contract`() {
        world.handle(packet(TspsServerPacket.CAMERA_CONTROL, TspsWriter().u8(13).u16(3356).u16(2208).u16(1023).u16(150).u8(3).u8(0)))
        val rotation = sent.single() as CamRotateToCoordinateV3
        assertEquals(3356 to 2208, rotation.x to rotation.z)
        assertEquals(1023, rotation.height)
        assertEquals(150, rotation.cycles)
        assertEquals(CameraEaseFunction.EASE_OUT_SINE, rotation.easing)
        assertEquals(false, rotation.heightRelative)
        assertEquals(false, rotation.trackTarget)
    }

    @Test
    fun `projectiles lock to their actors with rsprot's index convention`() {
        val projectile =
            TspsWriter().u16(1).u16(PROJECTILE).u16(3222).u16(3218).u8(0).u16(172).u16(3225).u16(3218).u8(0).u16(124)
                .u8(16).u16(64).u16(51).u16(75).u8(1).u16(PLAYER_INDEX).u8(2).u16(NPC_INDEX)
        world.handle(packet(TspsServerPacket.PROJECTILES, projectile))
        val sent = sent.single() as ProjAnimSpecificV4
        assertEquals(PROJECTILE, sent.id)
        assertEquals(-(PLAYER_INDEX + 1), sent.sourceIndex)
        assertEquals(NPC_INDEX + 1, sent.targetIndex)
        assertEquals(172 to 124, sent.startHeight to sent.endHeight)
    }

    @Test
    fun `a scene rebuild removes retained ground stacks before sending their replacements`() {
        val items = GroundItems { sent += it }
        items.rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z)
        val snapshot = TspsWriter().i32(1).u16(2)
        groundStack(snapshot, 1)
        groundStack(snapshot, 2) // Separate identical stacks must both survive.
        items.handle(packet(TspsServerPacket.GROUND_ITEMS, snapshot))
        assertEquals(2, sent.filterIsInstance<ObjAddSpecific>().size)
        sent.clear()
        items.handle(packet(TspsServerPacket.GROUND_ITEMS, snapshot))
        assertTrue(sent.isEmpty(), "an unchanged snapshot does not add another copy")

        repeat(5) {
            items.rebuild(LUMBRIDGE_ZONE_X + 4, LUMBRIDGE_ZONE_Z)
            assertEquals(listOf(ObjDelSpecific::class, ObjDelSpecific::class, ObjAddSpecific::class, ObjAddSpecific::class), sent.map { it::class })
            assertEquals(2, sent.filterIsInstance<ObjDelSpecific>().count { it.id == PLANK && it.quantity == 1 })
            assertEquals(2, sent.filterIsInstance<ObjAddSpecific>().count { it.id == PLANK && it.quantity == 1 })
            sent.clear()
        }

        val delta = TspsWriter().i32(2).u16(1)
        groundStack(delta, 1, quantity = 2)
        delta.u16(1).i32(2)
        items.handle(packet(TspsServerPacket.GROUND_ITEMS_DELTA, delta))
        assertEquals(listOf(ObjDelSpecific::class, ObjDelSpecific::class, ObjAddSpecific::class), sent.map { it::class }, "rebuild an ambiguous group after changing and removing its stacks")
        assertEquals(2, (sent.last() as ObjAddSpecific).quantity)
        sent.clear()
        items.handle(packet(TspsServerPacket.GROUND_ITEMS, TspsWriter().i32(3).u16(0)))
        assertEquals(2, (sent.single() as ObjDelSpecific).quantity)
    }

    @Test
    fun `ground stacks are restored once after leaving and returning to the scene`() {
        val items = GroundItems { sent += it }
        items.rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z)
        val snapshot = TspsWriter().i32(1).u16(1)
        groundStack(snapshot, 1)
        items.handle(packet(TspsServerPacket.GROUND_ITEMS, snapshot))
        sent.clear()
        items.rebuild(LUMBRIDGE_ZONE_X + 20, LUMBRIDGE_ZONE_Z)
        assertTrue(sent.single() is ObjDelSpecific)
        sent.clear()
        items.rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z)
        assertTrue(sent.single() is ObjAddSpecific)
    }

    @Test
    fun `single ground stack flags change without replacing it and survive scene rebuilds`() {
        val items = GroundItems { sent += it }
        items.rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z)
        val snapshot = TspsWriter().i32(1).u16(1)
        groundStack(snapshot, 1, enabledOps = 0b10101)
        items.handle(packet(TspsServerPacket.GROUND_ITEMS, snapshot))
        assertEquals(0b10101.toByte(), (sent.single() as ObjAddSpecific).opFlags)
        sent.clear()
        val delta = TspsWriter().i32(2).u16(1)
        groundStack(delta, 1, quantity = 2, enabledOps = 0b01010)
        delta.u16(0)
        items.handle(packet(TspsServerPacket.GROUND_ITEMS_DELTA, delta))
        assertEquals(listOf(ObjCountSpecific::class, ObjEnabledOpsSpecific::class), sent.map { it::class })
        assertEquals(0b01010.toByte(), (sent.last() as ObjEnabledOpsSpecific).opFlags)
        val encoder = ObjEnabledOpsSpecificEncoder()
        assertEquals(42, encoder.prot.opcode, "revision 242 obj_enabled_ops_specific")
        val wire = Unpooled.buffer().toJagByteBuf()
        try {
            encoder.encode(NopStreamCipher, wire, sent.last() as ObjEnabledOpsSpecific)
            val decoder = ServerPacketDecoderServiceV242(HuffmanCodec.create(Unpooled.wrappedBuffer(TestCache.huffman)), CacheProvider { HeadlessClient.NoCache })
            val decoded = decoder.decode(encoder.prot.opcode, wire, Session(0, AttributeMap())) as DecodedObjEnabledOpsSpecific
            assertEquals(0b01010, decoded.opFlags.value)
            assertEquals(PLANK, decoded.id)
            assertEquals(Triple(0, 3222, 3218), Triple(decoded.coordGrid.level, decoded.coordGrid.x, decoded.coordGrid.z))
        } finally {
            wire.buffer.release()
        }
        sent.clear()
        items.rebuild(LUMBRIDGE_ZONE_X + 20, LUMBRIDGE_ZONE_Z)
        assertTrue(sent.single() is ObjDelSpecific)
        sent.clear()
        items.rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z)
        assertEquals(0b01010.toByte(), (sent.single() as ObjAddSpecific).opFlags)
    }

    @Test
    fun `same item and quantity on one tile keep separate masks after change and removal`() {
        val items = GroundItems { sent += it }
        items.rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z)
        val snapshot = TspsWriter().i32(1).u16(2)
        groundStack(snapshot, 1, enabledOps = 0)
        groundStack(snapshot, 2, enabledOps = 31)
        items.handle(packet(TspsServerPacket.GROUND_ITEMS, snapshot))
        assertEquals(listOf(0.toByte(), 31.toByte()), sent.filterIsInstance<ObjAddSpecific>().map { it.opFlags })
        sent.clear()
        val delta = TspsWriter().i32(2).u16(1)
        groundStack(delta, 2, enabledOps = 4)
        delta.u16(0)
        items.handle(packet(TspsServerPacket.GROUND_ITEMS_DELTA, delta))
        assertEquals(listOf(ObjDelSpecific::class, ObjDelSpecific::class, ObjAddSpecific::class, ObjAddSpecific::class), sent.map { it::class })
        assertEquals(listOf(0.toByte(), 4.toByte()), sent.filterIsInstance<ObjAddSpecific>().map { it.opFlags })
        sent.clear()
        items.handle(packet(TspsServerPacket.GROUND_ITEMS_DELTA, TspsWriter().i32(3).u16(0).u16(1).i32(1)))
        assertEquals(listOf(ObjDelSpecific::class, ObjDelSpecific::class, ObjAddSpecific::class), sent.map { it::class })
        assertEquals(4.toByte(), (sent.last() as ObjAddSpecific).opFlags)
        sent.clear()
        val unchanged = TspsWriter().i32(4).u16(1)
        groundStack(unchanged, 2, enabledOps = 4)
        items.handle(packet(TspsServerPacket.GROUND_ITEMS, unchanged))
        assertTrue(sent.isEmpty(), "unchanged snapshots must not duplicate the retained item")
        items.handle(packet(TspsServerPacket.GROUND_ITEMS, TspsWriter().i32(5).u16(0)))
        assertTrue(sent.single() is ObjDelSpecific)
        sent.clear()
        val respawn = TspsWriter().i32(6).u16(1)
        groundStack(respawn, 3)
        items.handle(packet(TspsServerPacket.GROUND_ITEMS, respawn))
        assertEquals(31.toByte(), (sent.single() as ObjAddSpecific).opFlags)
    }

    @Test
    fun `stack ids exchanged between tiles remain visible for later rebuilds`() {
        val items = GroundItems { sent += it }
        items.rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z)
        val snapshot = TspsWriter().i32(1).u16(2)
        groundStack(snapshot, 1, enabledOps = 1, x = 3222)
        groundStack(snapshot, 2, enabledOps = 2, x = 3223)
        items.handle(packet(TspsServerPacket.GROUND_ITEMS, snapshot))
        sent.clear()
        val changed = TspsWriter().i32(2).u16(2)
        groundStack(changed, 1, enabledOps = 1, x = 3223)
        groundStack(changed, 2, enabledOps = 2, x = 3222)
        items.handle(packet(TspsServerPacket.GROUND_ITEMS, changed))
        assertEquals(2, sent.filterIsInstance<ObjDelSpecific>().size)
        assertEquals(setOf(3223 to 1.toByte(), 3222 to 2.toByte()), sent.filterIsInstance<ObjAddSpecific>().map { it.coordGrid.x to it.opFlags }.toSet())
        sent.clear()
        items.rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z)
        assertEquals(2, sent.filterIsInstance<ObjDelSpecific>().size, "both moved ids must remain in the visible set")
        assertEquals(2, sent.filterIsInstance<ObjAddSpecific>().size)
    }

    private fun groundStack(writer: TspsWriter, id: Int, quantity: Int = 1, enabledOps: Int = 31, x: Int = 3222) {
        writer.i32(id).u16(PLANK).i32(quantity).u16(x).u16(3218).u8(0)
            .i32(0).i32(0).i32(200).i32(-1).u8(0).u8(0).u8(enabledOps)
    }

    /** A tsps packet with [payload]'s bytes, as TspsCodec.split would hand it over. */
    private fun packet(opcode: Int, payload: TspsWriter) = TspsPacket(opcode, payload.body())

    private companion object {
        const val BOAT = 3000
        const val WORLD = 1
        const val DECK_ZONE = 1200
        const val LUMBRIDGE_ZONE_X = 3222 shr 3
        const val LUMBRIDGE_ZONE_Z = 3218 shr 3
        const val DOOR = 1543
        const val ANIM = 9105
        const val SOUND = 2739
        const val NPC_INDEX = 42
        const val PLAYER_INDEX = 7
        const val PROJECTILE = 91
        const val PLANK = 960
    }
}
