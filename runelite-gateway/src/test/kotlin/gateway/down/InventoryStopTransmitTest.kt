package gateway.down

import com.google.gson.Gson
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
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.TimeUnit

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

    @Test
    fun `server encoded pub shops publish stock to the inventory their native scripts watch`() {
        val shops = producerShops()
        assertEquals(setOf(1025, 1026, 1332, 1338, 1339, 1343, 1113, 0), shops.map { it.id }.toSet())
        for (shop in shops) {
            sent.clear()
            assertTrue(items.handle(TspsCodec.split(Base64.getDecoder().decode(shop.packet)).single()))
            val full = decodeFull(sent.filterIsInstance<UpdateInvFull>().single())
            assertEquals(shop.inventory, full.inventoryId, "shop ${shop.id}")
            assertEquals(shop.stock.map { it.id to it.amount }, full.objs.take(shop.stock.size).map { it.id to it.count })
            assertTrue(full.objs.drop(shop.stock.size).all { it.id == -1 })
            sent.clear()
            items.handle(TspsPacket(TspsServerPacket.SHOP_CLOSE, byteArrayOf()))
            assertEquals(shop.inventory, decodeStop(sent.single() as UpdateInvStopTransmit).inventoryId)
        }
    }

    @Test
    fun `switching and reopening shops resets the previous native inventory and legacy packets still use 516`() {
        fun open(inventory: Int?) {
            val packet = TspsWriter().string("shop").string("Shop").u16(995).u8(0).u8(1).u8(1)
                .u16(1).u16(0).u16(1917).i32(2_000_000_000).i32(2_000_000_000).i32(2).i32(1)
            if (inventory != null) packet.u16(inventory)
            items.handle(TspsPacket(TspsServerPacket.SHOP_OPEN, packet.body()))
        }
        open(933)
        sent.clear()
        open(976)
        assertEquals(933, decodeStop(sent.filterIsInstance<UpdateInvStopTransmit>().single()).inventoryId)
        assertEquals(976, decodeFull(sent.filterIsInstance<UpdateInvFull>().single()).inventoryId)
        sent.clear()
        open(976)
        assertTrue(sent.none { it is UpdateInvStopTransmit }, "refresh does not stop its own inventory")
        assertEquals(976, decodeFull(sent.single() as UpdateInvFull).inventoryId)
        sent.clear()
        open(null)
        assertEquals(976, decodeStop(sent.filterIsInstance<UpdateInvStopTransmit>().single()).inventoryId)
        assertEquals(516, decodeFull(sent.filterIsInstance<UpdateInvFull>().single()).inventoryId)
        sent.clear()
        items.handle(TspsPacket(TspsServerPacket.SHOP_CLOSE, byteArrayOf()))
        assertEquals(516, decodeStop(sent.single() as UpdateInvStopTransmit).inventoryId)
    }

    private class Stock(val id: Int, val amount: Int)
    private class Shop(val id: Int, val inventory: Int, val packet: String, val stock: List<Stock>)

    /** Real TSPS producer and authored stock, with native ids read from the active cache; no server/listeners. */
    private fun producerShops(): List<Shop> {
        val script = """
            const fs = require('node:fs');
            const { CachePipeline } = require('./server/src/main/typescript/elvarg/game/cache/CachePipeline');
            const { CacheDefinitions } = require('./server/src/main/typescript/elvarg/game/cache/CacheDefinitions');
            const { encodeShopOpen } = require('./server/src/main/typescript/elvarg/net/protocol/ClientProtocol');
            (async () => {
                await CachePipeline.initialize('./server');
                const names = require('./server/data/definitions/shop-inventories.json').inventories;
                const shops = require('./server/data/definitions/shops.json');
                const rows = [1025,1026,1332,1338,1339,1343,1113,0].map(id => {
                    const shop = shops.find(s => s.id === id);
                    const inventory = names[id] ? CacheDefinitions.getInventoryId(names[id]) : 516;
                    if (inventory == null) throw Error('missing native inventory ' + names[id]);
                    const stock = shop.originalStock;
                    const packet = encodeShopOpen(String(id), shop.name, 995, !!shop.generalStore, 1, 1,
                        stock.map((item, slot) => ({slot, itemId:item.id, quantity:item.amount,
                            defaultQuantity:item.amount, priceEach:2, sellPrice:1})), inventory);
                    return {id, inventory, stock, packet:packet.toString('base64')};
                });
                process.stdout.write(JSON.stringify(rows));
                CachePipeline.getStore().close();
            })().catch(error => { console.error(error); process.exitCode = 1; });
        """.trimIndent()
        // A file cannot fill the child's stdout pipe while this thread waits (notably on Windows).
        val outputFile = Files.createTempFile("tsps-shop-producer-", ".json")
        var process: Process? = null
        try {
            process = ProcessBuilder("node", "-r", "./server/node_modules/ts-node/register/transpile-only", "-e", script)
                .redirectOutput(outputFile.toFile())
                .redirectError(ProcessBuilder.Redirect.INHERIT).apply {
                    environment()["TS_NODE_PROJECT"] = "server/tsconfig.json"
                    environment()["BROWSER_HOST"] = "1" // Missing cache must fail instead of downloading.
                }.start()
            assertTrue(process.waitFor(60, TimeUnit.SECONDS), "server packet producer timed out")
            val output = Files.readString(outputFile)
            assertEquals(0, process.exitValue(), output)
            return Gson().fromJson(output, Array<Shop>::class.java).toList()
        } finally {
            if (process?.isAlive == true) {
                process.destroyForcibly()
                process.waitFor(5, TimeUnit.SECONDS)
            }
            Files.deleteIfExists(outputFile)
        }
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
