package gateway.it

import gateway.cache.VarTypes
import gateway.headless.HeadlessClient
import gateway.headless.TestCache
import net.rsprox.protocol.game.outgoing.model.info.npcinfo.NpcInfo
import net.rsprox.protocol.game.outgoing.model.info.npcinfo.NpcUpdateType
import net.rsprox.protocol.game.outgoing.model.info.playerinfo.PlayerInfo
import net.rsprox.protocol.game.outgoing.model.info.playerinfo.PlayerUpdateType
import net.rsprox.protocol.game.outgoing.model.interfaces.IfOpenSub
import net.rsprox.protocol.game.outgoing.model.interfaces.IfSetEventsV2
import net.rsprox.protocol.game.outgoing.model.interfaces.IfSetText
import net.rsprox.protocol.game.outgoing.model.inv.UpdateInvFull
import net.rsprox.protocol.game.outgoing.model.inv.UpdateInvPartial
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import net.rsprox.protocol.game.outgoing.model.misc.player.UpdateStatV2
import net.rsprox.protocol.game.outgoing.model.varp.VarpLarge
import net.rsprox.protocol.game.outgoing.model.varp.VarpSmall
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test

/** Everyday content through the official client's own interfaces: dialogues, prayers, spells. */
class ContentTest {
    private val vars = VarTypes(TestCache.cache)

    @Test
    fun `an npc dialogue continues and takes an option`() {
        LiveGateway.login(developer()).use { game ->
            game.expect<RebuildLoginV2>()
            game.command("tele $GUIDE_X $GUIDE_Z 0")
            var guide = -1
            var options = 0
            val lines = ArrayList<String>()
            var ticks = 0
            while (ticks < DIALOGUE_TICKS && lines.none { it == ANSWER }) {
                when (val message = game.next() ?: error("stream ended")) {
                    is ServerTickEnd -> if (++ticks == SETTLE_TICKS) game.npcOp1(guide)
                    is NpcInfo ->
                        message.updates.forEach { (index, update) ->
                            if (update is NpcUpdateType.LowResolutionToHighResolution && update.id == LUMBRIDGE_GUIDE) guide = index
                        }
                    // The chatbox's npc and player lines continue on component 5; 219 lists the options.
                    is IfOpenSub ->
                        when (message.interfaceId) {
                            NPC_LINE, PLAYER_LINE -> game.resume(message.interfaceId, CONTINUE)
                            OPTIONS -> if (options++ == 0) game.resume(OPTIONS, OPTION_LIST, QUEST_OPTION)
                        }
                    is IfSetText -> if (message.componentId == LINE_TEXT) lines += message.text
                }
            }
            assertTrue(guide >= 0, "the Lumbridge Guide is in view")
            assertTrue(options > 0, "the guide offers options")
            assertTrue(ANSWER in lines, "the chosen option is said, then answered: $lines")
        }
    }

    @Test
    fun `a prayer turns on and off from the prayer tab`() {
        LiveGateway.login(developer()).use { game ->
            game.expect<RebuildLoginV2>()
            val varps = HashMap<Int, Int>()
            game.ticks(SETTLE_TICKS, varps)
            game.button(PRAYER_TAB, THICK_SKIN)
            game.ticks(2, varps)
            assertEquals(1, varbit(varps, THICK_SKIN_VARBIT), "Thick Skin is on")
            game.button(PRAYER_TAB, THICK_SKIN)
            game.ticks(2, varps)
            assertEquals(0, varbit(varps, THICK_SKIN_VARBIT), "and off again")
        }
    }

    @Test
    fun `a teleport spell from the spellbook takes the player there`() {
        LiveGateway.login(developer()).use { game ->
            game.expect<RebuildLoginV2>()
            var magic = 0
            game.command("tele $GUIDE_X $GUIDE_Z 0")
            game.ticks(SETTLE_TICKS) { if (it is UpdateStatV2 && it.stat == MAGIC) magic = it.currentLevel }
            if (magic < VARROCK_TELEPORT_LEVEL) game.command("setlevel magic $VARROCK_TELEPORT_LEVEL")
            for ((rune, count) in VARROCK_TELEPORT_RUNES) game.command("item $rune $count")
            game.ticks(2)
            game.button(SPELLBOOK, VARROCK_TELEPORT)
            var at: Pair<Int, Int>? = null
            game.ticks(TELEPORT_TICKS) { message ->
                val update = (message as? PlayerInfo)?.updates?.get(game.index) as? PlayerUpdateType.HighResolutionMovement
                if (update != null) at = update.coord.x to update.coord.z
            }
            val (x, z) = requireNotNull(at) { "the player never moved" }
            assertTrue(kotlin.math.abs(x - VARROCK_X) <= LANDING && kotlin.math.abs(z - VARROCK_Z) <= LANDING, "landed at $x,$z, not in Varrock")
        }
    }

    @Test
    fun `high and low alchemy consume the earliest copy when a later inventory slot is targeted`() {
        for (spell in listOf(HIGH_ALCHEMY, LOW_ALCHEMY)) {
            LiveGateway.login(developer()).use { game ->
                game.expect<RebuildLoginV2>()
                game.command("clearinv")
                var magic = 0
                var slotEvents: IfSetEventsV2? = null
                val inventory = HashMap<Int, Pair<Int, Int>>()
                val track: (Any) -> Unit = { message ->
                    when (message) {
                        is UpdateStatV2 -> if (message.stat == MAGIC) magic = message.currentLevel
                        is IfSetEventsV2 -> if (message.interfaceId == INVENTORY && message.componentId == 0) slotEvents = message
                        is UpdateInvFull ->
                            if (message.inventoryId == MAIN_INVENTORY) {
                                inventory.clear()
                                message.objs.forEachIndexed { slot, obj -> if (obj.id >= 0) inventory[slot] = obj.id to obj.count }
                            }
                        is UpdateInvPartial ->
                            if (message.inventoryId == MAIN_INVENTORY) {
                                for (obj in message.objs) if (obj.id >= 0) inventory[obj.slot] = obj.id to obj.count else inventory.remove(obj.slot)
                            }
                    }
                }
                game.ticks(SETTLE_TICKS, each = track)
                // The official client only casts on (or uses onto) a slot whose events make it a target.
                val events = requireNotNull(slotEvents) { "the inventory's slots get their events" }.events1
                assertEquals(INVENTORY_TARGET_EVENTS, events and INVENTORY_TARGET_EVENTS, "live's target events on the inventory")
                if (magic < HIGH_ALCHEMY_LEVEL) game.command("setlevel magic $HIGH_ALCHEMY_LEVEL")
                for ((item, count) in HIGH_ALCHEMY_ITEMS) game.command("item $item $count")
                game.ticks(2, each = track)
                val coinsBefore = inventory.values.filter { it.first == COINS }.sumOf { it.second }
                val slots = inventory.filterValues { it.first == BRONZE_AXE }.keys.sorted()
                assertEquals(3, slots.size, "three separate axes are in $inventory")
                val clicked = slots.last()
                for ((count, consumed) in slots.withIndex()) {
                    game.buttonT((SPELLBOOK shl 16) or spell, NONE, NONE, INVENTORY shl 16, clicked, BRONZE_AXE)
                    game.ticks(ALCHEMY_TICKS, each = track)
                    assertTrue(inventory[consumed]?.first != BRONZE_AXE, "spell $spell must consume slot $consumed: $inventory")
                    if (consumed != clicked) assertEquals(BRONZE_AXE, inventory[clicked]?.first, "later clicked copy remains")
                    assertEquals(3 - count - 1, inventory.values.count { it.first == BRONZE_AXE }, "exactly one axe per cast")
                }
                assertTrue(inventory.values.filter { it.first == COINS }.sumOf { it.second } > coinsBefore, "coins came instead: $inventory")
            }
        }
    }

    private fun developer(): String {
        val developer = LiveGateway.developerName
        assumeTrue(developer != null, "DEV_USERNAME isn't set; the tests teleport and spawn runes")
        return developer!!
    }

    private fun varbit(varps: Map<Int, Int>, id: Int): Int {
        val bit = requireNotNull(vars.varbit(id))
        return ((varps[bit.varp] ?: 0) ushr bit.lsb) and ((1 shl (bit.msb - bit.lsb + 1)) - 1)
    }

    private fun HeadlessClient.Game.ticks(count: Int, varps: MutableMap<Int, Int>? = null, each: (Any) -> Unit = {}) {
        var seen = 0
        while (seen < count) {
            val message = next() ?: error("stream ended")
            each(message)
            when (message) {
                is ServerTickEnd -> seen++
                is VarpSmall -> varps?.put(message.id, message.value)
                is VarpLarge -> varps?.put(message.id, message.value)
            }
        }
    }

    private companion object {
        const val SETTLE_TICKS = 4
        const val DIALOGUE_TICKS = 20

        /** The Lumbridge Guide stands still at 3238,3220 (npc-spawns.json); this is in front of him. */
        const val LUMBRIDGE_GUIDE = 306
        const val GUIDE_X = 3236
        const val GUIDE_Z = 3220
        const val NPC_LINE = 231
        const val PLAYER_LINE = 217
        const val OPTIONS = 219
        const val OPTION_LIST = 1
        const val CONTINUE = 5
        const val LINE_TEXT = 6
        const val QUEST_OPTION = 1
        const val ANSWER = "Where can I find a quest to go on?"

        const val PRAYER_TAB = 541
        const val THICK_SKIN = 9
        const val THICK_SKIN_VARBIT = 4104

        const val SPELLBOOK = 218
        const val VARROCK_TELEPORT = 26
        const val VARROCK_TELEPORT_LEVEL = 25
        const val MAGIC = 6

        /** Law, air and fire runes. */
        val VARROCK_TELEPORT_RUNES = listOf(563 to 1, 556 to 3, 554 to 1)
        const val VARROCK_X = 3212
        const val VARROCK_Z = 3424
        const val LANDING = 6
        const val TELEPORT_TICKS = 10

        const val INVENTORY = 149
        const val MAIN_INVENTORY = 93
        const val INVENTORY_TARGET_EVENTS = (0x3F shl 11) or (1 shl 21)
        // Cache rev 241 spellbook components (magic_highalchemy / magic_lowalchemy).
        const val HIGH_ALCHEMY = 47
        const val LOW_ALCHEMY = 24
        const val HIGH_ALCHEMY_LEVEL = 55
        const val BRONZE_AXE = 1351
        const val COINS = 995
        const val NONE = 0xFFFF
        const val ALCHEMY_TICKS = 6

        /** Nature and fire runes, and the axe to alch. */
        val HIGH_ALCHEMY_ITEMS = listOf(561 to 3, 554 to 15, BRONZE_AXE to 3)
    }
}
