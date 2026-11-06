package gateway.spike

import gateway.cache.Cache
import gateway.config.GatewayConfig
import gateway.session.EntityWorld
import io.netty.buffer.PooledByteBufAllocator
import io.netty.buffer.Unpooled
import net.rsprot.compression.HuffmanCodec
import net.rsprot.compression.provider.DefaultHuffmanCodecProvider
import net.rsprot.protocol.game.outgoing.info.npcinfo.NpcInfo
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Two sessions' worlds in one JVM must not see each other's avatars. */
class EntityWorldTest {
    private val huffman =
        Cache.open(GatewayConfig.load().cacheDirectory).file(10, "huffman")!!.let {
            DefaultHuffmanCodecProvider(HuffmanCodec.create(Unpooled.wrappedBuffer(it)))
        }

    @Test
    fun `sessions keep separate player and npc views`() {
        val allocator = PooledByteBufAllocator.DEFAULT
        val first = EntityWorld(allocator, huffman)
        val second = EntityWorld(allocator, huffman)

        // Same tsps player index in both worlds, standing in Lumbridge.
        val firstSelf = first.allocPlayer(OBSERVER).placeAt(LUMBRIDGE_X, LUMBRIDGE_Z)
        val secondSelf = second.allocPlayer(OBSERVER).placeAt(LUMBRIDGE_X, LUMBRIDGE_Z)
        // Only the first session is shown a second player and an NPC next to it.
        first.allocPlayer(OTHER).placeAt(LUMBRIDGE_X + 1, LUMBRIDGE_Z)
        first.allocNpc(NPC_INDEX, HANS, 0, LUMBRIDGE_X, LUMBRIDGE_Z + 2)

        repeat(2) {
            first.update()
            second.update()
            val firstPackets = firstSelf.getPackets().rootWorldInfoPackets
            val secondPackets = secondSelf.getPackets().rootWorldInfoPackets
            assertTrue(firstPackets.playerInfo.isSuccess && firstPackets.npcInfo.isSuccess)
            assertTrue(secondPackets.playerInfo.isSuccess && secondPackets.npcInfo.isSuccess)
            firstPackets.playerInfo.getOrNull()!!.safeRelease()
            firstPackets.npcInfo.getOrNull()!!.safeRelease()
            secondPackets.playerInfo.getOrNull()!!.safeRelease()
            secondPackets.npcInfo.getOrNull()!!.safeRelease()
        }

        assertTrue(OTHER in firstSelf.playerInfo.getHighResolutionIndices())
        // The observer is never in its own high-resolution list.
        assertEquals(emptyList<Int>(), secondSelf.playerInfo.getHighResolutionIndices())
        assertEquals(listOf(NPC_INDEX), firstSelf.npcInfo.getHighResolutionIndices(NpcInfo.ROOT_WORLD))
        assertEquals(emptyList<Int>(), secondSelf.npcInfo.getHighResolutionIndices(NpcInfo.ROOT_WORLD))
    }

    private fun net.rsprot.protocol.game.outgoing.info.Infos.placeAt(x: Int, z: Int) =
        apply {
            updateRootCoord(0, x, z)
            updateRootBuildAreaCenteredOnPlayer(x, z)
        }

    private companion object {
        const val OBSERVER = 1
        const val OTHER = 2
        const val NPC_INDEX = 10
        const val HANS = 3105
        const val LUMBRIDGE_X = 3222
        const val LUMBRIDGE_Z = 3218
    }
}
