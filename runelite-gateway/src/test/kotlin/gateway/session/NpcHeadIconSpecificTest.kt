package gateway.session

import gateway.cache.NpcTypes
import gateway.cache.ObjTypes
import gateway.down.ActorBlock
import gateway.down.NpcSpecificEffects
import gateway.down.NpcSync
import gateway.headless.HeadlessClient
import gateway.headless.TestCache
import gateway.tsps.TspsCodec
import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import io.netty.buffer.PooledByteBufAllocator
import io.netty.buffer.Unpooled
import net.rsprot.buffer.extensions.toJagByteBuf
import net.rsprot.compression.HuffmanCodec
import net.rsprot.compression.provider.DefaultHuffmanCodecProvider
import net.rsprot.crypto.cipher.NopStreamCipher
import net.rsprot.protocol.game.outgoing.codec.specific.NpcHeadIconSpecificEncoder
import net.rsprot.protocol.game.outgoing.specific.NpcHeadIconSpecific
import net.rsprot.protocol.game.outgoing.info.npcinfo.NpcAvatar
import net.rsprot.protocol.game.outgoing.info.npcinfo.NpcAvatarExtendedInfo
import net.rsprot.protocol.game.outgoing.worldentity.SetActiveWorldV2
import net.rsprot.protocol.internal.game.outgoing.info.npcinfo.extendedinfo.HeadIconCustomisation
import net.rsprot.protocol.message.OutgoingGameMessage
import net.rsprox.cache.api.CacheProvider
import net.rsprox.protocol.game.outgoing.model.specific.NpcHeadIconSpecific as DecodedIcon
import net.rsprox.protocol.session.AttributeMap
import net.rsprox.protocol.session.Session
import net.rsprox.protocol.v241.ServerPacketDecoderServiceV241
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** Real observer mirrors and the revision-241 native encoder/decoder, including capture 239/04309. */
class NpcHeadIconSpecificTest {
    private fun mirror(): EntityMirror {
        val world = EntityWorld(PooledByteBufAllocator.DEFAULT,
            DefaultHuffmanCodecProvider(HuffmanCodec.create(Unpooled.wrappedBuffer(TestCache.huffman))))
        return EntityMirror(world, ObjTypes(TestCache.cache), NpcTypes(TestCache.cache), world.allocPlayer(1), 1, {})
    }

    private fun add(mirror: EntityMirror) {
        mirror.applyNpcs(NpcSync.Frame(listOf(NpcSync.Change.Added(10,
            NpcSync.Npc(10, 7221, 3298, 9870, 0), 0, false)), emptyMap()), 0)
    }

    private fun icon(index: Int, slot: Int, group: Int, frame: Int) =
        TspsPacket(26, TspsWriter().u16(index).u8(slot).u16(group).u16(frame).body())

    /** Inspect the real state owner consumed by rsprot's NPC_INFO encoder. */
    private fun globalIcons(mirror: EntityMirror): HeadIconCustomisation {
        @Suppress("UNCHECKED_CAST")
        val npcs = EntityMirror::class.java.getDeclaredField("npcs").apply { isAccessible = true }
            .get(mirror) as Map<Int, NpcAvatar>
        val blocks = NpcAvatarExtendedInfo::class.java.getDeclaredField("blocks").apply { isAccessible = true }
            .get(npcs.getValue(10).extendedInfo)
        return blocks.javaClass.getMethod("getHeadIconCustomisation").invoke(blocks) as HeadIconCustomisation
    }

    private fun decode(icon: NpcHeadIconSpecific): DecodedIcon {
        val encoder = NpcHeadIconSpecificEncoder()
        val buffer = Unpooled.buffer()
        try {
            val wire = buffer.toJagByteBuf()
            encoder.encode(NopStreamCipher, wire, icon)
            assertEquals(9, buffer.readableBytes())
            val decoder = ServerPacketDecoderServiceV241(
                HuffmanCodec.create(Unpooled.wrappedBuffer(ByteArray(256) { 8 })),
                CacheProvider { HeadlessClient.NoCache },
            )
            return decoder.decode(encoder.prot.opcode, wire, Session(0, AttributeMap())) as DecodedIcon
        } finally {
            buffer.release()
        }
    }

    @Test fun `captured active icon replacement and slot clear retain unsigned fields on native wire`() {
        assertEquals(7, TspsServerPacket.LENGTHS[26])
        val framed = TspsCodec.split(TspsWriter().u16(32874).u8(0).u16(6405).u16(1).fixed(26)).single()
        val sent = ArrayList<OutgoingGameMessage>()
        var flushes = 0
        // Preserve the captured unsigned NPC index independently of the server's local index allocator.
        val effects = NpcSpecificEffects({ it.takeIf { id -> id == 32874 } }, { sent += it }, { flushes++ })
        assertTrue(effects.handle(framed))
        assertTrue(effects.handle(icon(32874, 7, 6405, 0)))
        assertTrue(effects.handle(icon(32874, 0, 65535, 65535)))
        val decoded = sent.map { decode(it as NpcHeadIconSpecific) }
        assertEquals(listOf(32874, 32874, 32874), decoded.map { it.index })
        assertEquals(listOf(0, 7, 0), decoded.map { it.headIconSlot })
        assertEquals(listOf(6405, 6405, 65535), decoded.map { it.spriteGroup })
        assertEquals(listOf(1, 0, 65535), decoded.map { it.spriteIndex })
        assertEquals(3, flushes)
    }

    @Test fun `real observer mirrors discard absent removed and reused targets without replay`() {
        val mirror = mirror()
        try {
            val sent = ArrayList<OutgoingGameMessage>()
            var flushes = 0
            val effects = NpcSpecificEffects(mirror::npcIndex, { sent += it }, { flushes++ })
            assertTrue(effects.handle(icon(10, 0, 6405, 1)))
            add(mirror)
            assertTrue(sent.isEmpty())
            assertTrue(effects.handle(icon(10, 0, 6405, 1)))
            assertEquals(listOf(NpcHeadIconSpecific(10, 0, 6405, 1)), sent)
            sent.clear()
            mirror.applyNpcs(NpcSync.Frame(listOf(NpcSync.Change.Removed(10)), emptyMap()), 0)
            assertTrue(effects.handle(icon(10, 0, 65535, 65535)))
            add(mirror)
            assertTrue(sent.isEmpty(), "no stale clear or icon follows a reused index")
            assertEquals(1, flushes)
        } finally {
            mirror.release()
        }
    }

    @Test fun `specific icons isolate observers and do not replace global mirror headicon updates`() {
        val first = mirror(); val second = mirror()
        try {
            add(first); add(second)
            val aSent = ArrayList<OutgoingGameMessage>()
            val bSent = ArrayList<OutgoingGameMessage>()
            val a = NpcSpecificEffects(first::npcIndex, { aSent += it }, {})
            val b = NpcSpecificEffects(second::npcIndex, { bSent += it }, {})
            val baseline = globalIcons(first).headIconGroups.copyOf()
            assertTrue(a.handle(icon(10, 0, 6405, 1)))
            assertArrayEquals(baseline, globalIcons(first).headIconGroups,
                "specific packets cannot mutate the shared NPC_INFO avatar")
            assertTrue(bSent.isEmpty())
            // Exercise the real global update path after the observer-specific packet.
            val global = ActorBlock().apply { headIcons = listOf(440 to 2) }
            first.applyNpcs(NpcSync.Frame(emptyList(), mapOf(10 to global)), 0)
            second.applyNpcs(NpcSync.Frame(emptyList(), mapOf(10 to global)), 0)
            for (observer in listOf(first, second)) {
                assertEquals(440, globalIcons(observer).headIconGroups[0])
                assertEquals(2, globalIcons(observer).headIconIndices[0].toInt())
                assertEquals(-1, globalIcons(observer).headIconGroups[3])
            }
            assertEquals(listOf(NpcHeadIconSpecific(10, 0, 6405, 1)), aSent)
            assertTrue(bSent.isEmpty(), "global changes stay in NPC_INFO, not specific packet state")
            assertTrue(b.handle(icon(10, 3, 6405, 0)))
            assertEquals(listOf(NpcHeadIconSpecific(10, 3, 6405, 0)), bSent)
        } finally {
            first.release(); second.release()
        }
    }

    @Test fun `headicon deck routing restores root before immediate flush`() {
        val mirror = mirror()
        try {
            add(mirror)
            val sent = ArrayList<OutgoingGameMessage>()
            val deck = SetActiveWorldV2(SetActiveWorldV2.DynamicWorldType(7, 1))
            val root = SetActiveWorldV2.getRoot(2)
            var flushes = 0
            val effects = NpcSpecificEffects(mirror::npcIndex, { sent += it }, {
                assertEquals(listOf(deck, NpcHeadIconSpecific(10, 7, 6405, 1), root), sent)
                flushes++
            }, { deck to root })
            assertTrue(effects.handle(icon(10, 7, 6405, 1)))
            assertEquals(1, flushes)
        } finally {
            mirror.release()
        }
    }
}
