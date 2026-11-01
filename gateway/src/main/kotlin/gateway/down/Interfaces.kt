package gateway.down

import gateway.coverage.DropCounter
import gateway.session.InterfaceTree
import gateway.session.VarpMirror
import gateway.tsps.TspsPacket
import gateway.tsps.TspsReader
import gateway.tsps.TspsServerPacket
import net.rsprot.protocol.game.outgoing.interfaces.IfCloseSub
import net.rsprot.protocol.game.outgoing.interfaces.IfMoveSub
import net.rsprot.protocol.game.outgoing.interfaces.IfOpenSub
import net.rsprot.protocol.game.outgoing.interfaces.IfOpenTop
import net.rsprot.protocol.game.outgoing.interfaces.IfSetAngle
import net.rsprot.protocol.game.outgoing.interfaces.IfSetAnim
import net.rsprot.protocol.game.outgoing.interfaces.IfSetColour
import net.rsprot.protocol.game.outgoing.interfaces.IfSetEventsV2
import net.rsprot.protocol.game.outgoing.interfaces.IfSetHide
import net.rsprot.protocol.game.outgoing.interfaces.IfSetModelV2
import net.rsprot.protocol.game.outgoing.interfaces.IfSetNpcHead
import net.rsprot.protocol.game.outgoing.interfaces.IfSetObject
import net.rsprot.protocol.game.outgoing.interfaces.IfSetPlayerHead
import net.rsprot.protocol.game.outgoing.interfaces.IfSetPosition
import net.rsprot.protocol.game.outgoing.interfaces.IfSetText
import net.rsprot.protocol.game.outgoing.misc.player.RunClientScript
import net.rsprot.protocol.game.outgoing.misc.player.TriggerOnDialogAbort
import net.rsprot.protocol.game.outgoing.misc.player.UpdateStatV2
import net.rsprot.protocol.game.outgoing.varp.VarpLong
import net.rsprot.protocol.message.OutgoingGameMessage

/**
 * tsps's interface, var, script and stat messages as their OSRS packets.
 *
 * tsps bundles some of these (WIDGET_OPEN_SUB carries varps, varbits, hidden components and
 * scripts; WIDGET_RUN_SCRIPT carries vars and inventories). They are split here in the order
 * the browser client applies them.
 */
class Interfaces(
    private val varps: VarpMirror,
    private val tree: InterfaceTree,
    private val stockMarket: StockMarket,
    /** Inventories riding on WIDGET_RUN_SCRIPT, by OSRS inv id. */
    private val inventories: (TspsReader) -> Unit,
    /** Whether the client has this component; anything aimed at one it hasn't is dropped. */
    private val exists: (Int) -> Boolean,
    private val send: (OutgoingGameMessage) -> Unit,
) {
    /** Returns false for a message this translator doesn't handle. */
    fun handle(packet: TspsPacket): Boolean {
        val reader = packet.reader()
        when (packet.opcode) {
            TspsServerPacket.WIDGET_SET_ROOT -> setRoot(reader.u16())
            TspsServerPacket.WIDGET_OPEN -> {
                val group = reader.u16()
                val modal = reader.u8() != 0
                if (!modal || group >= CUSTOM_INTERFACE_START) {
                    DropCounter.down(packet.opcode)
                } else {
                    openSub(tree.modalTarget(), group, MODAL)
                }
            }
            TspsServerPacket.WIDGET_CLOSE -> tree.targetOf(reader.u16())?.let { send(IfCloseSub(it ushr 16, it and 0xFFFF)) }
            TspsServerPacket.WIDGET_OPEN_SUB -> openSubBundle(reader)
            TspsServerPacket.WIDGET_CLOSE_SUB -> {
                val raw = reader.i32()
                tree.gameframe(raw, mounted = false)
                val target = tree.remap(raw)
                tree.unmounted(target)
                send(IfCloseSub(target ushr 16, target and 0xFFFF))
            }
            TspsServerPacket.WIDGET_SET_TEXT -> component(reader) { i, c -> IfSetText(i, c, reader.string()) }
            TspsServerPacket.WIDGET_SET_HIDDEN -> component(reader) { i, c -> IfSetHide(i, c, reader.u8() != 0) }
            TspsServerPacket.WIDGET_SET_ITEM ->
                component(reader) { i, c ->
                    val obj = reader.u16().let { if (it == 0xFFFF) -1 else it }
                    IfSetObject(i, c, obj, reader.i32())
                }
            TspsServerPacket.WIDGET_SET_NPC_HEAD -> component(reader) { i, c -> IfSetNpcHead(i, c, reader.u16()) }
            TspsServerPacket.WIDGET_SET_PLAYER_HEAD -> component(reader) { i, c -> IfSetPlayerHead(i, c) }
            TspsServerPacket.WIDGET_SET_ANIMATION -> component(reader) { i, c -> IfSetAnim(i, c, reader.s16()) }
            TspsServerPacket.WIDGET_SET_ANGLE -> component(reader) { i, c -> IfSetAngle(i, c, reader.u16(), reader.u16(), reader.u16()) }
            TspsServerPacket.WIDGET_SET_MODEL -> component(reader) { i, c -> IfSetModelV2(i, c, reader.i32()) }
            TspsServerPacket.WIDGET_SET_POSITION -> component(reader) { i, c -> IfSetPosition(i, c, reader.s16(), reader.s16()) }
            TspsServerPacket.WIDGET_SET_COLOUR ->
                component(reader) { i, c ->
                    val rgb = reader.u16()
                    IfSetColour(i, c, (rgb ushr 10) and 0x1F, (rgb ushr 5) and 0x1F, rgb and 0x1F)
                }
            TspsServerPacket.WIDGET_SET_FLAGS -> {
                val uid = tree.remap(reader.i32())
                events(uid, -1, -1, reader.i32())
            }
            TspsServerPacket.WIDGET_SET_FLAGS_RANGE -> {
                val uid = tree.remap(reader.i32())
                events(uid, reader.u16(), reader.u16(), reader.i32())
            }
            TspsServerPacket.WIDGET_SET_FLAGS_RANGE_V2 -> {
                val uid = tree.remap(reader.i32())
                val start = reader.u16().signed16()
                val end = reader.u16().signed16()
                val flags = reader.i32()
                val ops = reader.i32()
                if (exists(uid)) send(IfSetEventsV2(uid ushr 16, uid and 0xFFFF, start, end, flags, ops)) else dropped(uid)
            }
            TspsServerPacket.WIDGET_RUN_SCRIPT -> runScriptBundle(reader)
            TspsServerPacket.RUN_CLIENT_SCRIPT -> script(reader.u16(), reader)
            TspsServerPacket.TRIGGER_ONDIALOGABORT -> send(TriggerOnDialogAbort)
            TspsServerPacket.VARP_SMALL -> varp(reader.u16(), reader.u8())
            TspsServerPacket.VARP_LARGE -> varp(reader.u16(), reader.i32())
            TspsServerPacket.VARP_LONG -> send(VarpLong(reader.u16(), reader.i64()))
            TspsServerPacket.VARBIT -> varps.setVarbit(reader.u16(), reader.i32())?.let(send) ?: DropCounter.down(packet.opcode)
            TspsServerPacket.SKILLS_SNAPSHOT, TspsServerPacket.SKILLS_DELTA -> stats(reader)
            else -> return false
        }
        return true
    }

    private fun varp(id: Int, value: Int) {
        when {
            stockMarket.isOfferVarp(id) -> stockMarket.setVarp(id, value)
            else -> varps.setVarp(id, value)?.let(send) ?: DropCounter.down(TspsServerPacket.VARP_LARGE)
        }
    }

    /**
     * tsps shows the welcome screen as the browser's root. Live keeps the game behind it: it logs
     * in on root 165 with the gameframe moved there and the welcome screen as a modal in 165:40,
     * and on Play closes it and moves the gameframe to the player's root. As the root alone, the
     * client had no game view: the login screen stayed behind it, with "Loading - please wait".
     * Any other root change (a game client layout chosen in the settings) moves the mounts the
     * same way, after setting the client's window mode to match.
     */
    private fun setRoot(group: Int) {
        val from = tree.root
        val welcome = welcomeShown
        welcomeShown = group == WELCOME_SCREEN
        if (welcome) send(IfCloseSub(InterfaceTree.LOGIN_ROOT, InterfaceTree.WELCOME_SLOT))
        tree.setRoot(if (welcomeShown) InterfaceTree.LOGIN_ROOT else group)
        // The client's window mode has to match the layout: fixed in a 765x503 canvas, resizable
        // filling the window. Its script 3998 (run by the server, given 0 fixed, 1 resizable
        // classic, 2 resizable modern) sets it, and does nothing when it already matches. The
        // browser sizes itself, so tsps doesn't send it.
        WINDOW_MODE_LAYOUT[tree.root]?.let { send(RunClientScript(SET_LAYOUT_SCRIPT, listOf(it))) }
        send(IfOpenTop(tree.root))
        // The browser moves tsps's mounts to a new root itself; the official client needs each one
        // moved, as live does on Play and on a game client layout change.
        for ((source, target) in tree.moves(from)) send(IfMoveSub(source ushr 16, source and 0xFFFF, target ushr 16, target and 0xFFFF))
        if (welcomeShown) openSub((InterfaceTree.LOGIN_ROOT shl 16) or InterfaceTree.WELCOME_SLOT, WELCOME_SCREEN, MODAL)
    }

    private var welcomeShown = false

    private fun openSub(target: Int, group: Int, type: Int) {
        tree.mounted(target, group)
        send(IfOpenSub(target ushr 16, target and 0xFFFF, group, type))
    }

    /** `WIDGET_OPEN_SUB`: target, group, type, then varps, varbits, hidden uids, pre and post scripts. */
    private fun openSubBundle(reader: TspsReader) {
        val raw = reader.i32()
        val target = tree.remap(raw)
        val group = reader.u16()
        val type = reader.u8()
        repeat(reader.optionalU8()) { varp(reader.u16(), reader.i32()) }
        repeat(reader.optionalU8()) { varps.setVarbit(reader.u16(), reader.i32())?.let(send) }
        val hidden = List(reader.optionalU8()) { reader.i32() }
        val preScripts = scripts(reader)
        val postScripts = scripts(reader)
        preScripts.forEach(send)
        if (group >= CUSTOM_INTERFACE_START) {
            DropCounter.down(TspsServerPacket.WIDGET_OPEN_SUB)
            return
        }
        tree.gameframe(raw, mounted = true)
        openSub(target, group, type)
        for (uid in hidden) if (exists(uid)) send(IfSetHide(uid ushr 16, uid and 0xFFFF, true)) else dropped(uid)
        postScripts.forEach(send)
    }

    /** `WIDGET_RUN_SCRIPT`: i32 script (-1: vars only), args, u16-counted varps and varbits, inventories. */
    private fun runScriptBundle(reader: TspsReader) {
        val id = reader.i32()
        val args = args(reader)
        repeat(reader.u16()) { varp(reader.i32(), reader.i32()) }
        repeat(reader.u16()) { varps.setVarbit(reader.i32(), reader.i32())?.let(send) }
        if (reader.remaining > 0) inventories(reader)
        if (id >= 0) send(RunClientScript(id, args))
    }

    private fun script(id: Int, reader: TspsReader) = send(RunClientScript(id, args(reader)))

    private fun scripts(reader: TspsReader): List<OutgoingGameMessage> =
        List(reader.optionalU8()) {
            val id = reader.i32()
            RunClientScript(id, if (reader.remaining > 0) args(reader) else emptyList())
        }

    private fun args(reader: TspsReader): List<Any> =
        List(reader.u8()) {
            when (reader.u8()) {
                ARG_STRING -> reader.string()
                ARG_LONG -> reader.i64()
                else -> reader.i32()
            }
        }

    /** Old-format flags carry ops 1-10 in bits 1-10; IF_SETEVENTS_V2 wants them in events2. */
    private fun events(uid: Int, start: Int, end: Int, flags: Int) {
        val ops = (flags ushr 1) and OLD_OP_BITS
        if (!exists(uid)) return dropped(uid)
        // The official client only lets a selected spell or Use land on a slot whose events say
        // it's a target (bit 21), and an item's own Use reaches what bits 11-16 allow. tsps leaves
        // them out, as the browser makes its inventory menus another way; live sets them.
        val events = if (uid == INVENTORY) flags or INVENTORY_TARGET_EVENTS else flags
        send(IfSetEventsV2(uid ushr 16, uid and 0xFFFF, start.signed16(), end.signed16(), events and (OLD_OP_BITS shl 1).inv(), ops))
    }

    private fun stats(reader: TspsReader) {
        repeat(reader.u8()) {
            val stat = reader.u8()
            val experience = reader.i32()
            reader.u8() // base level
            reader.u8() // virtual level
            reader.u8() // boost + 128
            val current = reader.u8()
            send(UpdateStatV2(stat, current, current, experience))
        }
        reader.u16() // total level
        // The browser works the combat level out itself and shows it from this varbit.
        varps.setVarbit(COMBAT_LEVEL_VARBIT, reader.u8())?.let(send)
    }

    private inline fun component(reader: TspsReader, message: (Int, Int) -> OutgoingGameMessage) {
        val uid = tree.remap(reader.i32())
        val built = message(uid ushr 16, uid and 0xFFFF)
        if (exists(uid)) send(built) else dropped(uid)
    }

    private fun dropped(uid: Int) = DropCounter.missingComponent(uid)

    private fun TspsReader.optionalU8() = if (remaining > 0) u8() else 0

    private fun Int.signed16() = if (this == 0xFFFF) -1 else this

    private companion object {
        const val MODAL = 0
        const val INVENTORY = 149 shl 16

        /** Live's inventory events beyond tsps's: Use on ground items, NPCs, locs, players, items and components (11-16), and being a target (21). */
        const val INVENTORY_TARGET_EVENTS = (0x3F shl 11) or (1 shl 21)
        const val WELCOME_SCREEN = 378
        const val SET_LAYOUT_SCRIPT = 3998

        /** Each gameframe root's layout, as script 3998 takes it. */
        val WINDOW_MODE_LAYOUT = mapOf(548 to 0, 161 to 1, 164 to 2)
        const val CUSTOM_INTERFACE_START = 30_000
        const val ARG_STRING = 0
        const val ARG_LONG = 2
        const val OLD_OP_BITS = 0x3FF
        const val COMBAT_LEVEL_VARBIT = 13027
    }
}
