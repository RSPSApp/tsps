package gateway.down

import gateway.cache.ObjTypes
import gateway.headless.HeadlessClient
import gateway.headless.TestCache
import gateway.tsps.TspsCodec
import gateway.tsps.TspsPacket
import gateway.tsps.TspsReader
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import io.netty.buffer.Unpooled
import net.rsprot.buffer.extensions.toJagByteBuf
import net.rsprot.compression.HuffmanCodec
import net.rsprot.crypto.cipher.NopStreamCipher
import net.rsprot.protocol.game.outgoing.codec.inv.UpdateInvFullEncoder
import net.rsprot.protocol.game.outgoing.codec.inv.UpdateInvStopTransmitEncoder
import net.rsprot.protocol.game.outgoing.inv.UpdateInvFull
import net.rsprot.protocol.game.outgoing.inv.UpdateInvStopTransmit
import net.rsprot.protocol.message.OutgoingGameMessage
import net.rsprox.cache.api.CacheProvider
import net.rsprox.protocol.game.outgoing.model.inv.UpdateInvFull as DecodedFull
import net.rsprox.protocol.game.outgoing.model.inv.UpdateInvStopTransmit as DecodedStop
import net.rsprox.protocol.session.AttributeMap
import net.rsprox.protocol.session.Session
import net.rsprox.protocol.v242.ServerPacketDecoderServiceV242
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** TSPS framing -> real Items mirror -> rsprot encoder -> independent revision-241 decoder. */
class InventoryStopTransmitTest {
    private val sent = ArrayList<OutgoingGameMessage>()
    private val items = Items(ObjTypes(TestCache.cache)) { sent += it }
    private val session = Session(0, AttributeMap())
    private val decoder = ServerPacketDecoderServiceV242(
        HuffmanCodec.create(Unpooled.wrappedBuffer(ByteArray(256) { 8 })),
        CacheProvider { HeadlessClient.NoCache },
    )

    @Test
    fun `captured containers unknown and repeated stops preserve the unsigned inventory id`() {
        for (id in listOf(95, 516, 646, 65535, 95)) {
            assertTrue(items.handle(TspsCodec.split(TspsWriter().u16(id).fixed(56)).single()))
            val stop = sent.removeLast() as UpdateInvStopTransmit
            assertEquals(id, decodeStop(stop).inventoryId)
        }
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `a bank partial after stop recreates an empty mirror without stale slots`() {
        items.handle(TspsPacket(TspsServerPacket.BANK_SNAPSHOT,
            TspsWriter().u16(10).u16(2).slot(0, 995, 100).u8(0).slot(4, 554, 7).u8(0).body()))
        val original = decodeFull(sent.last() as UpdateInvFull)
        assertEquals(995 to 100, original.objs[0].id to original.objs[0].count)
        items.handle(TspsCodec.split(TspsWriter().u16(95).fixed(56)).single())
        sent.clear()
        items.handle(TspsPacket(TspsServerPacket.BANK_SLOT, TspsWriter().slot(2, 561, 3).u8(0).body()))
        val resumed = decodeFull(sent.single() as UpdateInvFull)
        assertEquals(95, resumed.inventoryId)
        assertEquals(listOf(-1 to 0, -1 to 0, 561 to 3), resumed.objs.map { it.id to it.count })
    }

    @Test
    fun `stopping inventory clears carried counts and later updates resume normally`() {
        items.handle(TspsPacket(TspsServerPacket.INVENTORY_SNAPSHOT, TspsWriter().u16(1).slot(0, 995, 20).body()))
        assertEquals(20, items.carried(995))
        items.handle(TspsCodec.split(TspsWriter().u16(93).fixed(56)).single())
        assertEquals(0, items.carried(995))
        sent.clear()
        items.handle(TspsPacket(TspsServerPacket.INVENTORY_SLOT, TspsWriter().slot(3, 554, 5).body()))
        assertEquals(0, items.carried(995))
        assertEquals(5, items.carried(554))
        val resumed = decodeFull(sent.filterIsInstance<UpdateInvFull>().single())
        assertEquals(-1, resumed.objs[0].id)
        assertEquals(554 to 5, resumed.objs[3].id to resumed.objs[3].count)
    }

    @Test
    fun `bag and league snapshots resume after stop and shop close keeps its native reset`() {
        for (id in listOf(516, 646)) {
            scriptInventory(id, 0, 995, 20)
            items.handle(TspsCodec.split(TspsWriter().u16(id).fixed(56)).single())
            scriptInventory(id, 2, 554, 7)
            val resumed = decodeFull(sent.last() as UpdateInvFull)
            assertEquals(id, resumed.inventoryId)
            assertEquals(-1, resumed.objs[0].id)
            assertEquals(554 to 7, resumed.objs[2].id to resumed.objs[2].count)
        }
        sent.clear()
        assertTrue(items.handle(TspsPacket(TspsServerPacket.SHOP_CLOSE, byteArrayOf())))
        assertEquals(516, decodeStop(sent.single() as UpdateInvStopTransmit).inventoryId)
    }

    private fun scriptInventory(id: Int, slot: Int, item: Int, count: Int) {
        items.scriptInventories(TspsReader(TspsWriter().u8(1).u16(id).u16(28).u16(1).slot(slot, item, count).body()))
    }

    private fun TspsWriter.slot(slot: Int, item: Int, count: Int): TspsWriter =
        u16(slot).u16(item + 1).u8(255).i32(count)

    private fun decodeStop(message: UpdateInvStopTransmit): DecodedStop {
        val encoder = UpdateInvStopTransmitEncoder()
        val buffer = Unpooled.buffer()
        try {
            val wire = buffer.toJagByteBuf()
            encoder.encode(NopStreamCipher, wire, message)
            assertEquals(80, encoder.prot.opcode, "revision 242 update_inv_stoptransmit")
            assertEquals(2, buffer.readableBytes())
            return decoder.decode(encoder.prot.opcode, wire, session) as DecodedStop
        } finally { buffer.release() }
    }

    private fun decodeFull(message: UpdateInvFull): DecodedFull {
        val encoder = UpdateInvFullEncoder()
        val buffer = Unpooled.buffer()
        try {
            val wire = buffer.toJagByteBuf()
            encoder.encode(NopStreamCipher, wire, message)
            return decoder.decode(encoder.prot.opcode, wire, session) as DecodedFull
        } finally { buffer.release() }
    }
}
