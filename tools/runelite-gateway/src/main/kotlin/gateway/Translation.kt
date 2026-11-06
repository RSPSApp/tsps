package gateway
import java.io.*
import net.rsprot.protocol.game.outgoing.info.playerinfo.PlayerAvatarExtendedInfo
import net.rsprot.protocol.game.incoming.misc.user.MoveGameClick
import net.rsprot.protocol.message.codec.incoming.*
import net.rsprot.protocol.message.IncomingGameMessage
import net.rsprot.protocol.game.outgoing.interfaces.*
import net.rsprot.protocol.game.outgoing.varp.*
import net.rsprot.protocol.game.outgoing.misc.player.*
import net.rsprot.protocol.game.outgoing.inv.*
import net.rsprot.protocol.common.game.outgoing.inv.InventoryObject
import net.rsprot.protocol.game.incoming.misc.user.MoveMinimapClick
import net.rsprot.protocol.game.incoming.npcs.OpNpcV2
import net.rsprot.protocol.game.incoming.buttons.*
import net.rsprot.protocol.game.incoming.locs.OpLocV2
import net.rsprot.protocol.game.incoming.resumed.*
import net.rsprot.protocol.game.incoming.messaging.MessagePublic
import net.rsprot.protocol.game.incoming.misc.user.ClientCheat
import net.rsprot.protocol.game.incoming.misc.user.CloseModal
import net.rsprot.protocol.game.incoming.misc.user.SetChatFilterSettings
import net.rsprot.protocol.game.outgoing.logout.Logout
import net.rsprot.protocol.message.OutgoingGameMessage
fun DataInputStream.text():String {val b=ByteArrayOutputStream();while(true){val c=readUnsignedByte();if(c==0)break;b.write(c)};return b.toString("ISO-8859-1")}
private fun DataInputStream.appearanceSlots():Pair<IntArray,Int> {
 val slots=IntArray(12)
 for(copy in 0..1)for(slot in 0..11){
  val hi=readUnsignedByte();val v=if(hi==0)0 else (hi shl 8) or readUnsignedByte()
  if(copy==0 && slot==0 && v==65535)return slots to readUnsignedShort()
  if(copy==0)slots[slot]=v
 }
 return slots to -1
}
fun appearance(e:PlayerAvatarExtendedInfo,b:ByteArray) {
 val d=DataInputStream(ByteArrayInputStream(b));e.setBodyType(d.readUnsignedByte());e.setSkullIcon(d.readByte().toInt());e.setOverheadIcon(d.readByte().toInt())
 val kitSlots=mapOf(4 to 2,6 to 3,7 to 5,8 to 0,9 to 4,10 to 6,11 to 1)
 val(slots,transform)=d.appearanceSlots();e.setTransmogrification(transform)
 if(transform<0)for(slot in slots.indices){val v=slots[slot];if(v>=2048)e.setWornObj(slot,v-2048,-1,-1) else {e.setWornObj(slot,-1,-1,-1);kitSlots[slot]?.let{e.setIdentKit(it,if(v>=256)v-256 else -1)}}}
 repeat(5){e.setColour(it,d.readUnsignedByte())}
 val anim=IntArray(7){d.readUnsignedShort().let{if(it==65535)-1 else it}}
 e.setBaseAnimationSet(anim[0],anim[1],anim[2],anim[3],anim[4],anim[5],anim[6]);e.setName(d.text());e.setCombatLevel(d.readUnsignedByte());e.setSkillLevel(d.readUnsignedShort());e.setHidden(d.readUnsignedByte()!=0)
}
/** Equipment's only upstream update is the authoritative appearance, including its ammo trailer. */
fun equipmentFromAppearance(bytes:ByteArray):UpdateInvFull {
 val d=DataInputStream(ByteArrayInputStream(bytes));d.skipBytes(3);val(slots,transform)=d.appearanceSlots()
 val items=mutableListOf<Long>()
 if(transform<0)for(slot in listOf(0,1,2,3,4,5,7,9,10))if(slots[slot]>=2048)items.add(InventoryObject.pack(slot,slots[slot]-2048,1))
 d.skipBytes(19);d.text();d.skipBytes(4);d.readUnsignedShort();repeat(3){d.text()};d.readUnsignedByte()
 val ammoCount=d.readInt();val ammo=d.readInt();val quiver=d.readInt()
 if(ammo>=0)items.add(InventoryObject.pack(13,ammo,ammoCount))
 if(quiver>=0)items.add(InventoryObject.pack(12,quiver,1))
 return full(94,14,items)
}
data class UpstreamAction(val opcode:Int,val bytes:ByteArray,val lengthBytes:Int=0)
// Pinned rev241 logout.if3: logout:logout (182:8), transmitop=1.
private const val LOGOUT_BUTTON=(182 shl 16) or 8
private const val COMBAT_LEVEL_VARBIT=13027
private const val SUMMARY_CONTENTS=(712 shl 16) or 2
private const val SUMMARY_CLICK_LAYER=(712 shl 16) or 3
private const val SUMMARY_COMBAT_LEVEL_TRANSMIT=3954
fun nativeAction(m:IncomingGameMessage):UpstreamAction? {
 fun action(op:Int,length:Int=0,block:DataOutputStream.()->Unit={})=UpstreamAction(op,payload(block),length)
 fun widget(uid:Int,group:Int,child:Int,op:Int,sub:Int,obj:Int)=action(251,1){
  writeInt(uid);writeShort(group);writeShort(child);text("");text("");writeByte(op);writeByte(op)
  writeShort(0);writeShort(0);writeByte(0);writeShort(sub);writeShort(obj)
 }
 return when(m){
  is MoveGameClick -> action(210){writeShort(m.x);writeShort(m.z);writeByte(m.keyCombination shl 1)}
  is MoveMinimapClick -> action(210){writeShort(m.x);writeShort(m.z);writeByte(m.keyCombination shl 1)}
  is OpLocV2 -> action(231,1){writeShort(m.id);writeShort(m.x);writeShort(m.z);writeByte(0);text("");writeByte(m.op)}
  is OpNpcV2 -> when(m.op){
   1->action(76){writeByte(0);writeByte(m.index shr 8);writeByte((m.index+128) and 255)}
   2->action(12){writeByte(m.index shr 8);writeByte((m.index+128) and 255);writeByte(0)}
   3->action(34){writeByte((m.index+128) and 255);writeByte(m.index shr 8);writeByte(0)}
   4->action(70){writeByte(0);writeByte(m.index);writeByte(m.index shr 8)}
   5->action(57){writeByte(128);writeByte(m.index);writeByte(m.index shr 8)}
   else->null
  }
  is If1Button -> if(m.combinedId==LOGOUT_BUTTON)action(203) else widget(m.combinedId,m.interfaceId,m.componentId,1,-1,-1)
  is If3Button -> if(m.combinedId==LOGOUT_BUTTON && m.op==1)action(203) else widget(m.combinedId,m.interfaceId,m.componentId,m.op,m.sub,m.obj)
  is ResumePauseButton -> action(252){writeInt(m.combinedId);writeShort(m.sub)}
  is ResumePCountDialog -> action(192){writeInt(m.count)}
  is ResumePNameDialog -> action(193,1){text(m.name)}
  is ResumePStringDialog -> action(194,1){text(m.string)}
  is MessagePublic -> when(m.type){0,1,2->action(190,1){writeByte(if(m.type==1)3 else m.type);text(m.message)};else->null}
  is ClientCheat -> if(m.autocomplete)null else action(190,1){writeByte(0);text("::"+m.command)}
  is SetChatFilterSettings -> action(198){writeByte(m.publicChatFilter);writeByte(m.privateChatFilter);writeByte(m.tradeChatFilter)}
  is CloseModal -> action(55)
  else->null
 }
}
fun consumers():GameMessageConsumerRepository<Bridge> {
 val consumer=MessageConsumer<Bridge,IncomingGameMessage>{b,m->nativeAction(m)?.let{b.upstream.send(it.opcode,it.bytes,it.lengthBytes)}}
 return GameMessageConsumerRepository(listOf(MoveGameClick::class.java,MoveMinimapClick::class.java,OpNpcV2::class.java,
  OpLocV2::class.java,If1Button::class.java,If3Button::class.java,ResumePauseButton::class.java,ResumePCountDialog::class.java,
  ResumePNameDialog::class.java,ResumePStringDialog::class.java,MessagePublic::class.java,ClientCheat::class.java,
  SetChatFilterSettings::class.java,CloseModal::class.java).associateWith{consumer},emptyList())
}
private fun DataInputStream.scriptArgs():List<Any> = List(readUnsignedByte()){
 when(val type=readUnsignedByte()){0->text();1->readInt();2->readLong();else->error("Unsupported TSPS script argument $type")}
}
private fun DataInputStream.script()=RunClientScript(readInt(),scriptArgs())
private fun DataInputStream.item():Long{
 val slot=readUnsignedShort();val id=readUnsignedShort()-1;val count=readUnsignedByte().let{if(it==255)readInt() else it}
 return InventoryObject.pack(slot,id,count)
}
private fun partial(inv:Int,items:List<Long>)=UpdateInvPartial(inv,object:UpdateInvPartial.IndexedObjectProvider(items.indices.iterator()){
 override fun provide(slot:Int):Long=items[slot]
})
private fun full(inv:Int,capacity:Int,items:List<Long>):UpdateInvFull{
 val slots=items.associateBy{InventoryObject.getSlot(it)}
 return UpdateInvFull(inv,capacity){slots[it]?:InventoryObject.NULL}
}
private var varbitDefinitions:Map<Int,IntArray> = emptyMap()
fun configureVarbits(definitions:Map<Int,IntArray>){varbitDefinitions=definitions}
private var nativeVarpCapacity=Int.MAX_VALUE
private val unsupportedVarps=mutableSetOf<Int>()
fun configureVarpCapacity(capacity:Int){require(capacity>0);nativeVarpCapacity=capacity;unsupportedVarps.clear()}
private var nativeWidgetExists:(Int)->Boolean = {true}
private val unsupportedWidgets=mutableSetOf<Int>()
fun configureWidgetComponents(validator:(Int)->Boolean){nativeWidgetExists=validator;unsupportedWidgets.clear()}
class TranslationState(private val definitions:Map<Int,IntArray> = varbitDefinitions){
 private val varps=mutableMapOf<Int,Int>()
 fun varp(id:Int,value:Int):VarpLarge{varps[id]=value;return VarpLarge(id,value)}
 fun varbit(id:Int,value:Int):VarpLarge?{
  val def=definitions[id]?:return null;val(base,start,end)=def
  val mask=if(end-start==31)-1 else (1 shl(end-start+1))-1
  val stored=if(value<0 || (mask != -1 && value>mask))0 else value
  return varp(base,((varps[base]?:0) and (mask shl start).inv()) or ((stored and mask) shl start))
 }
}
private val translationStates=java.util.WeakHashMap<Bridge,TranslationState>()
fun Bridge.outgoing(op:Int,p:ByteArray){val s=session?:return;translateOutgoing(op,p,translationStates.getOrPut(this){TranslationState()}).forEach(s::queue)}
fun translateOutgoing(op:Int,p:ByteArray,state:TranslationState=TranslationState()):List<OutgoingGameMessage>{
 val d=DataInputStream(ByteArrayInputStream(p));val result=mutableListOf<OutgoingGameMessage>()
 fun send(m:OutgoingGameMessage){
  val id=when(m){is VarpLarge->m.id;is VarpSmall->m.id;is VarpLong->m.id;else->null}
  if(id!=null && id !in 0 until nativeVarpCapacity){
   if(unsupportedVarps.add(id))System.err.println("[gateway] Ignoring browser-only varp $id outside native capacity $nativeVarpCapacity")
   return
  }
  val uid=when(m){
   is IfSetText->m.combinedId
   is IfSetHide->m.combinedId
   is IfSetObject->m.combinedId
   is IfSetNpcHead->m.combinedId
   is IfSetEventsV2->m.combinedId
   is IfSetAnim->m.combinedId
   is IfSetPlayerHead->m.combinedId
   is IfSetModelV2->m.combinedId
   is IfSetPosition->m.combinedId
   is IfSetColour->m.combinedId
   is IfSetAngle->m.combinedId
   is IfCloseSub->m.combinedId
   is IfOpenSub->m.destinationCombinedId
   is IfOpenTop->m.interfaceId shl 16
   else->null
  }
  val subGroup=if(m is IfOpenSub)m.interfaceId shl 16 else null
  val invalid=listOfNotNull(uid,subGroup).firstOrNull{!nativeWidgetExists(it)}
  if(invalid!=null){
   if(unsupportedWidgets.add(invalid))System.err.println("[gateway] Ignoring browser-only widget ${invalid ushr 16}:${invalid and 65535} absent from native cache")
   return
  }
  result.add(m)
 }
 fun pairs(count:Int,shortKeys:Boolean,bits:Boolean){repeat(count){val id=if(shortKeys)d.readUnsignedShort() else d.readInt();val v=d.readInt();if(bits)state.varbit(id,v)?.let(::send) else send(state.varp(id,v))}}
 when(op){
  4->if(d.readUnsignedByte()!=0)send(Logout)
  50->send(full(93,28,List(d.readUnsignedShort()){d.item()}))
  51->send(partial(93,listOf(d.item())))
  52->{val capacity=d.readUnsignedShort();val items=List(d.readUnsignedShort()){val item=d.item();d.readUnsignedByte();item};send(full(95,capacity,items))}
  53->{val item=d.item();d.readUnsignedByte();send(partial(95,listOf(item)))}
  70,71->{
   repeat(d.readUnsignedByte()){
    val id=d.readUnsignedByte();val xp=d.readInt();d.readUnsignedByte();d.readUnsignedByte();d.readUnsignedByte();val current=d.readUnsignedByte()
    send(UpdateStatV2(id,current,current,xp))
   }
   // TSPS writes nine bytes per skill, then total/combat, then unused allocation padding.
   d.readUnsignedShort();val combat=d.readUnsignedByte()
   state.varbit(COMBAT_LEVEL_VARBIT,combat)?.let(::send)
   // Rev241 summary_sidepanel_combat_level_transmit sets varc52 and redraws the panel.
   if(nativeWidgetExists(SUMMARY_CONTENTS) && nativeWidgetExists(SUMMARY_CLICK_LAYER))
    send(RunClientScript(SUMMARY_COMBAT_LEVEL_TRANSMIT,listOf(SUMMARY_CONTENTS,SUMMARY_CLICK_LAYER,combat)))
  }
  81->send(UpdateRunEnergy(d.readUnsignedByte()*100))
  40->send(state.varp(d.readUnsignedShort(),d.readUnsignedByte()))
  41->send(state.varp(d.readUnsignedShort(),d.readInt()))
  42->state.varbit(d.readUnsignedShort(),d.readInt())?.let(::send)
  44->send(VarpLong(d.readUnsignedShort(),d.readLong()))
  102->send(IfOpenTop(d.readUnsignedShort()))
  103->{
   val uid=d.readInt();val group=d.readUnsignedShort();val type=d.readUnsignedByte()
   pairs(d.readUnsignedByte(),true,false);pairs(d.readUnsignedByte(),true,true)
   val hidden=List(d.readUnsignedByte()){d.readInt()}
   repeat(d.readUnsignedByte()){send(d.script())}
   send(IfOpenSub(uid,group,type));hidden.forEach{send(IfSetHide(it,true))}
   repeat(d.readUnsignedByte()){send(d.script())}
  }
  104->send(IfCloseSub(d.readInt()))
  105->send(IfSetText(d.readInt(),d.text()))
  106->send(IfSetHide(d.readInt(),d.readUnsignedByte()!=0))
  107->send(IfSetObject(d.readInt(),d.readUnsignedShort().let{if(it==65535)-1 else it},d.readInt()))
  108->send(IfSetNpcHead(d.readInt(),d.readUnsignedShort().let{if(it==65535)-1 else it}))
  109,111,112->{
   val uid=d.readInt();val start=if(op==111)-1 else d.readUnsignedShort();val end=if(op==111)-1 else d.readUnsignedShort();val flags=d.readInt()
   val ops=if(op==112)d.readInt() else (flags ushr 1) and 1023
   send(IfSetEventsV2(uid,start,end,flags,ops))
  }
  110->{
   val script=d.script();pairs(d.readUnsignedShort(),false,false);pairs(d.readUnsignedShort(),false,true)
   if(d.available()>0)repeat(d.readUnsignedByte()){
    val inv=d.readUnsignedShort();val capacity=d.readUnsignedShort();send(full(inv,capacity,List(d.readUnsignedShort()){d.item()}))
   };send(script)
  }
  113->send(IfSetAngle(d.readInt(),d.readUnsignedShort(),d.readUnsignedShort(),d.readUnsignedShort()))
  114->send(IfSetAnim(d.readInt(),d.readShort().toInt()))
  115->send(IfSetPlayerHead(d.readInt()))
  117->send(IfSetModelV2(d.readInt(),d.readInt()))
  118->send(IfSetPosition(d.readInt(),d.readShort().toInt(),d.readShort().toInt()))
  119->send(IfSetColour(d.readInt(),d.readUnsignedShort()))
  120->{val text=d.text();val type=d.readUnsignedByte();val from=d.text();d.text();d.readUnsignedShort();send(MessageGame(type,from.ifEmpty{null},text))}
  170->send(RunClientScript(d.readUnsignedShort(),d.scriptArgs()))
 }
 return result
}
