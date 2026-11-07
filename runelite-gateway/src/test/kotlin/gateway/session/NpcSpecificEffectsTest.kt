package gateway.session

import gateway.cache.NpcTypes
import gateway.cache.ObjTypes
import gateway.down.NpcSpecificEffects
import gateway.down.NpcSync
import gateway.headless.TestCache
import gateway.tsps.TspsCodec
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import io.netty.buffer.PooledByteBufAllocator
import io.netty.buffer.Unpooled
import net.rsprot.compression.HuffmanCodec
import net.rsprot.compression.provider.DefaultHuffmanCodecProvider
import net.rsprot.protocol.game.outgoing.specific.NpcAnimSpecific
import net.rsprot.protocol.game.outgoing.specific.NpcSpotAnimSpecific
import net.rsprot.protocol.message.OutgoingGameMessage
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class NpcSpecificEffectsTest {
    private val worlds = ArrayList<EntityWorld>()
    private fun mirror(): EntityMirror {
        val world = EntityWorld(PooledByteBufAllocator.DEFAULT,
            DefaultHuffmanCodecProvider(HuffmanCodec.create(Unpooled.wrappedBuffer(TestCache.huffman))))
        worlds += world
        return EntityMirror(world, ObjTypes(TestCache.cache), NpcTypes(TestCache.cache), world.allocPlayer(1), 1, {})
    }
    private fun add(mirror: EntityMirror, index: Int = 10) {
        mirror.applyNpcs(NpcSync.Frame(listOf(NpcSync.Change.Added(index, NpcSync.Npc(index, 7221, 3298, 9870, 0), 0, false)), emptyMap()), 0)
    }
    private fun anim(index: Int, id: Int, delay: Int) = TspsCodec.split(TspsWriter().u16(index).u16(id).u8(delay).fixed(24)).single()
    private fun spot(index: Int, id: Int, slot: Int, height: Int, delay: Int) = TspsCodec.split(TspsWriter().u16(index).u16(id).u8(slot).u16(height).u16(delay).fixed(25)).single()

    @Test fun `post-info specific effects preserve all fields and flush immediately`() {
        val mirror = mirror()
        add(mirror, 32000)
        val sent = ArrayList<OutgoingGameMessage>()
        var flushed = 0
        val effects = NpcSpecificEffects(mirror::npcIndex, { sent += it }, { flushed++ })
        assertTrue(effects.handle(anim(32000, 12207, 255)))
        assertTrue(effects.handle(spot(32000, 3353, 255, 65535, 65535)))
        assertEquals(NpcAnimSpecific(32000, 12207, 255), sent[0])
        assertEquals(NpcSpotAnimSpecific(32000, 3353, 255, 65535, 65535), sent[1])
        assertEquals(2, flushed)
        mirror.release()
    }

    @Test fun `reset id stays the unsigned native sentinel and slots remain independent`() {
        val mirror = mirror(); add(mirror)
        val sent = ArrayList<OutgoingGameMessage>()
        val effects = NpcSpecificEffects(mirror::npcIndex, { sent += it }, {})
        effects.handle(anim(10, -1, 0))
        effects.handle(spot(10, 3353, 2, 120, 30))
        effects.handle(spot(10, -1, 3, 0, 0))
        assertEquals(NpcAnimSpecific(10, 65535, 0), sent[0])
        assertEquals(NpcSpotAnimSpecific(10, 3353, 2, 120, 30), sent[1])
        assertEquals(NpcSpotAnimSpecific(10, 65535, 3, 0, 0), sent[2])
        mirror.release()
    }

    @Test fun `unknown and removed targets are discarded without delayed replay`() {
        val mirror = mirror()
        val sent = ArrayList<OutgoingGameMessage>()
        var flushed = 0
        val effects = NpcSpecificEffects(mirror::npcIndex, { sent += it }, { flushed++ })
        assertTrue(effects.handle(anim(10, 12207, 0)))
        add(mirror)
        assertTrue(sent.isEmpty())
        mirror.applyNpcs(NpcSync.Frame(listOf(NpcSync.Change.Removed(10)), emptyMap()), 0)
        assertTrue(effects.handle(spot(10, 3353, 2, 0, 0)))
        add(mirror)
        assertTrue(sent.isEmpty())
        assertEquals(0, flushed)
        mirror.release()
    }

    @Test fun `a deck target selects its native world and restores root before flushing`() {
        val mirror = mirror(); add(mirror)
        val sent = ArrayList<OutgoingGameMessage>()
        val deck = net.rsprot.protocol.game.outgoing.worldentity.SetActiveWorldV2(
            net.rsprot.protocol.game.outgoing.worldentity.SetActiveWorldV2.DynamicWorldType(7, 1))
        val root = net.rsprot.protocol.game.outgoing.worldentity.SetActiveWorldV2.getRoot(2)
        var flushed = 0
        val effects = NpcSpecificEffects(mirror::npcIndex, { sent += it }, {
            assertEquals(listOf(deck, NpcAnimSpecific(10, 12207, 0), root), sent)
            flushed++
        }, { deck to root })
        effects.handle(anim(10, 12207, 0))
        assertEquals(1, flushed)
        mirror.release()
    }
    @Test fun `two observers share npc indexes without sharing effect state`() {
        val first = mirror(); val second = mirror()
        add(first); add(second)
        val firstSent = ArrayList<OutgoingGameMessage>()
        val secondSent = ArrayList<OutgoingGameMessage>()
        val a = NpcSpecificEffects(first::npcIndex, { firstSent += it }, {})
        val b = NpcSpecificEffects(second::npcIndex, { secondSent += it }, {})
        a.handle(anim(10, 12207, 0))
        b.handle(spot(10, 3353, 2, 0, 30))
        assertEquals(listOf(NpcAnimSpecific(10, 12207, 0)), firstSent)
        assertEquals(listOf(NpcSpotAnimSpecific(10, 3353, 2, 0, 30)), secondSent)
        assertFalse(a.handle(gateway.tsps.TspsPacket(TspsServerPacket.TICK, ByteArray(8))))
        first.release(); second.release()
    }
}