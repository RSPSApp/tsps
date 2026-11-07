package gateway.session

import gateway.cache.Cache
import gateway.config.GatewayConfig
import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import io.netty.buffer.PooledByteBufAllocator
import io.netty.buffer.Unpooled
import net.rsprot.compression.HuffmanCodec
import net.rsprot.compression.provider.DefaultHuffmanCodecProvider
import net.rsprot.protocol.game.outgoing.info.Infos
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** A boat as tsps sends it (REBUILD_WORLDENTITY then WORLDENTITY_INFO), through rsprot. */
class WorldEntitiesTest {
    private val huffman =
        Cache.open(GatewayConfig.load().cacheDirectory).file(10, "huffman")!!.let {
            DefaultHuffmanCodecProvider(HuffmanCodec.create(Unpooled.wrappedBuffer(it)))
        }
    private val world = EntityWorld(PooledByteBufAllocator.DEFAULT, huffman)
    private val boats = WorldEntities(world)
    private val self =
        world.allocPlayer(OBSERVER).apply {
            updateRootCoord(0, DOCK_X, DOCK_Z)
            updateRootBuildAreaCenteredOnPlayer(DOCK_X, DOCK_Z)
            worldEntityInfo.updateRenderDistance(RENDER_DISTANCE)
        }

    @Test
    fun `a boat comes into view with its world, and its deck scene is the template`() {
        boats.onRebuild(TspsPacket(TspsServerPacket.REBUILD_WORLDENTITY, rebuild()))
        boats.onInfo(TspsPacket(TspsServerPacket.WORLDENTITY_INFO, spawn()), 0)

        val added = tick().activeWorlds.single()
        // rsprot takes world ids below 2048; tsps's 3000+ get one of the session's own.
        assertEquals(WORLD to true, added.worldId to added.added)
        assertEquals(BOAT, boats.tspsIndex(WORLD), "the client's world-entity ops name tsps's boat")

        val deck = boats.deck(BOAT)!!
        assertTrue(deck.contains(DECK_ZONE shl 3, DECK_ZONE shl 3) && boats.deckAt((DECK_ZONE shl 3) + 7, DECK_ZONE shl 3) == deck)
        assertNull(boats.deckAt(DOCK_X, DOCK_Z), "the main world is no deck")
        val rebuild = deck.rebuild()
        assertEquals(DECK_ZONE shl 3, rebuild.baseX)
        assertEquals(List(LEVELS) { TEMPLATE_X }, rebuild.zones.filterNotNull().map { it.zoneX })

        // Moved along: still the same world, no longer new.
        boats.onInfo(TspsPacket(TspsServerPacket.WORLDENTITY_INFO, TspsWriter().u8(1).u8(MOVED).position(SPEED, 0).u8(0).body()), 0)
        val moved = tick().activeWorlds.single()
        assertEquals(WORLD to false, moved.worldId to moved.added)

        // Gone.
        boats.onInfo(TspsPacket(TspsServerPacket.WORLDENTITY_INFO, TspsWriter().u8(1).u8(GONE).body()), 0)
        assertEquals(listOf(WORLD), tick().removedWorldIndices)
        assertNull(boats.deck(BOAT))
    }

    private fun tick(): net.rsprot.protocol.game.outgoing.info.InfoPackets {
        world.update()
        val packets = self.getPackets()
        assertTrue(packets.rootWorldInfoPackets.worldEntityInfo.isSuccess)
        // A boat world rsprot can't take fails its NPC info, which ends the session.
        packets.activeWorlds.forEach { world -> world.npcInfo.exceptionOrNull()?.let { throw it } }
        packets.rootWorldInfoPackets.npcInfo.exceptionOrNull()?.let { throw it }
        packets.rootWorldInfoPackets.worldEntityInfo.getOrNull()!!.safeRelease()
        packets.rootWorldInfoPackets.playerInfo.getOrNull()?.safeRelease()
        packets.rootWorldInfoPackets.npcInfo.getOrNull()?.safeRelease()
        packets.activeWorlds.forEach { it.npcInfo.getOrNull()?.safeRelease() }
        return packets
    }

    /** tsps's encodeRebuildWorldEntity, with one template zone at the scene centre on each level. */
    private fun rebuild(): ByteArray {
        val writer =
            TspsWriter()
                .u16(BOAT)
                .u16(RAFT)
                .u8(DECK_TILES)
                .u8(DECK_TILES)
                .u16(DECK_ZONE)
                .u16(DECK_ZONE)
                .u16(DECK_ZONE)
                .u8(0)
                .u16(DECK_ZONE)
                .u16(1)
                .u8(0)
        val bits = BitWriter()
        for (level in 0 until LEVELS) {
            for (x in 0 until SCENE_ZONES) {
                for (z in 0 until SCENE_ZONES) {
                    val centre = x == SCENE_CENTRE && z == SCENE_CENTRE
                    bits.write(1, if (centre) 1 else 0)
                    if (centre) bits.write(26, (level shl 24) or (TEMPLATE_X shl 14) or (TEMPLATE_Z shl 3))
                }
            }
        }
        return writer.bytes(bits.toByteArray()).bytes(ByteArray(16)).body()
    }

    /** A WORLDENTITY_INFO with no boats yet and the raft as a new one, moored facing north. */
    private fun spawn(): ByteArray =
        TspsWriter().u8(0).u16(BOAT).u8(DECK_TILES).u8(DECK_TILES).u16(RAFT).position(DOCK_X * 128 + 640, DOCK_Z * 128, NORTH).u8(0).u8(0).body()

    /** tsps's writeWorldEntityPosition: flags, then x, y (0), z and angle at their widths. */
    private fun TspsWriter.position(x: Int, z: Int, angle: Int = 0): TspsWriter {
        val values = intArrayOf(x, 0, z, angle)
        fun width(value: Int) = if (value == 0) 0 else if (value in -128..127) 1 else if (value in -32768..32767) 2 else 3
        u8(values.withIndex().sumOf { (index, value) -> width(value) shl (index * 2) })
        for (value in values) {
            when (width(value)) {
                1 -> u8(value)
                2 -> u16(value)
                3 -> i32(value)
            }
        }
        return this
    }

    private class BitWriter {
        private val bytes = java.io.ByteArrayOutputStream()
        private var current = 0
        private var count = 0

        fun write(width: Int, value: Int) {
            for (bit in width - 1 downTo 0) {
                current = (current shl 1) or ((value ushr bit) and 1)
                if (++count == 8) {
                    bytes.write(current)
                    current = 0
                    count = 0
                }
            }
        }

        fun toByteArray(): ByteArray {
            if (count > 0) bytes.write(current shl (8 - count))
            return bytes.toByteArray()
        }
    }

    private companion object {
        const val OBSERVER = 1
        const val BOAT = 3000
        const val WORLD = 1
        const val RAFT = 1
        const val DECK_TILES = 8
        const val DECK_ZONE = 1200
        const val TEMPLATE_X = 480
        const val TEMPLATE_Z = 807
        const val DOCK_X = 3069
        const val DOCK_Z = 2987
        const val NORTH = 1024
        const val SPEED = 32
        const val MOVED = 2
        const val GONE = 0
        const val LEVELS = 4
        const val SCENE_ZONES = 13
        const val SCENE_CENTRE = 6
        const val RENDER_DISTANCE = 40
    }
}
