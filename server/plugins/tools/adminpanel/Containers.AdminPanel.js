// Isolated Admin widgets using the active cache's worn layout (387), slot sprites
// (3282), inventory spacing (6007/6010), and eight-column bank layout.
// These never bind the viewer's real inventory IDs or run native equipment ops.
const { TYPE_GRAPHIC } = require('../../interface/widgetGroup');
const C = { VIEW: 600, SCROLLBAR: 601, INVENTORY: 602, EQUIPMENT: 603, HEIGHT: 604,
  BANK_VIEW: 650, BANK_SCROLLBAR: 651, BANK_TABS: 652, BANK_HEIGHT: 653, BANK_INFO: 654,
  BANK_TAB_START: 660, BANK_TAB_LABEL_START: 670,
  INVENTORY_FRAME_START: 1800, BANK_FRAME_START: 4500,
  INVENTORY_START: 2000, EQUIPMENT_BACKGROUND_START: 2100, EQUIPMENT_GHOST_START: 2120,
  EQUIPMENT_START: 2140, BANK_START: 3000 };
const BANK_SLOTS = 1410, BANK_COLUMNS = 8, BANK_PITCH_X = 48, BANK_PITCH_Y = 36;
const SLOT_FRAME_SPRITE = 170, VERTICAL_LINK_SPRITE = 172, HORIZONTAL_LINK_SPRITE = 173;
const EQUIPMENT = [[0,77,4,'Head'],[1,36,43,'Cape'],[2,77,43,'Neck'],[3,21,82,'Weapon'],
  [4,77,82,'Body'],[5,133,82,'Shield'],[7,77,122,'Legs'],[9,21,162,'Hands'],
  [10,77,162,'Feet'],[12,133,162,'Ring'],[13,118,43,'Ammo']];
const hide = { hidden: true, isHidden: true };
const SLOT_FLAGS = 0x3e | (1 << 17) | (1 << 20);
function slotFor(component) {
  if (component >= C.INVENTORY_START && component < C.INVENTORY_START + 28) return { container: 'inventory', slot: component - C.INVENTORY_START };
  if (component >= C.EQUIPMENT_START && component < C.EQUIPMENT_START + 14 && EQUIPMENT.some(([slot]) => slot === component - C.EQUIPMENT_START)) return { container: 'equipment', slot: component - C.EQUIPMENT_START };
  if (component >= C.BANK_START && component < C.BANK_START + BANK_SLOTS) return { container: 'bank', slot: component - C.BANK_START };
  return null;
}
const slotComponents = () => [...Array.from({length:28},(_,i)=>C.INVENTORY_START+i),
  ...EQUIPMENT.map(([slot])=>C.EQUIPMENT_START+slot), ...Array.from({length:BANK_SLOTS},(_,i)=>C.BANK_START+i)];
function build(add, root, text, box, ghostIcons = new Map()) {
  const view = add(C.VIEW, root, { rawX:18, rawY:116, rawWidth:294, rawHeight:130,
    widthMode:1, heightMode:1, width:200, height:186, scrollHeight:261, ...hide });
  add(C.SCROLLBAR, root, {rawX:258,rawY:116,rawWidth:14,rawHeight:130,heightMode:1,xPositionMode:2,...hide});
  const inventory = add(C.INVENTORY, view, {rawWidth:190,rawHeight:261,width:190,height:261,xPositionMode:1,...hide});
  const equipment = add(C.EQUIPMENT, view, {rawWidth:190,rawHeight:202,width:190,height:202,xPositionMode:1,...hide});
  add(C.HEIGHT, root, {type:4,...hide});
  const graphic = (id,parent,x,y,width,height,extra={}) => add(id,parent,{type:TYPE_GRAPHIC,rawX:x,rawY:y,rawWidth:width,rawHeight:height,width,height,...extra});
  // Native connecting strips and native empty worn-slot frames, behind the items.
  [[77,39,36,124,VERTICAL_LINK_SPRITE],[21,118,36,45,VERTICAL_LINK_SPRITE],[133,118,36,45,VERTICAL_LINK_SPRITE],
    [56,81,78,36,HORIZONTAL_LINK_SPRITE],[71,42,48,36,HORIZONTAL_LINK_SPRITE]].forEach(([x,y,w,h,spriteId],i)=>graphic(2080+i,equipment,x,y,w,h,{spriteId}));
  for (const [slot,x,y,name] of EQUIPMENT) {
    graphic(C.EQUIPMENT_BACKGROUND_START+slot,equipment,x,y,36,36,{spriteId:SLOT_FRAME_SPRITE});
    graphic(C.EQUIPMENT_GHOST_START+slot,equipment,x+2,y+2,32,32,{spriteId:ghostIcons.get(slot)??-1});
    graphic(C.EQUIPMENT_START+slot,equipment,x,y,36,36,{adminContainer:'equipment',dataText:name,...slotOptions()});
  }
  for(let i=0;i<28;i++) {
    const x=12+i%4*42,y=5+Math.floor(i/4)*36;
    add(C.INVENTORY_FRAME_START+i,inventory,box(x,y,36,32,{adminContainerFrame:'inventory',filled:false,color:0x806845}));
    graphic(C.INVENTORY_START+i,inventory,x,y,36,32,{adminContainer:'inventory',...slotOptions()});
  }
  const bank=add(C.BANK_VIEW,root,{rawX:18,rawY:178,rawWidth:54,rawHeight:192,widthMode:1,heightMode:1,width:440,height:124,scrollHeight:36,...hide});
  add(C.BANK_SCROLLBAR,root,{rawX:18,rawY:178,rawWidth:14,rawHeight:192,heightMode:1,xPositionMode:2,...hide});
  add(C.BANK_HEIGHT,root,{type:4,...hide});
  add(C.BANK_INFO,root,text(18,150,150,26,{widthMode:1,textColor:0xb9ab96,...hide}));
  const tabs=add(C.BANK_TABS,root,{rawX:18,rawY:116,rawWidth:440,rawHeight:30,width:440,height:30,...hide});
  for(let i=0;i<10;i++) {
    add(C.BANK_TAB_START+i,tabs,box(i*43,0,40,28,{flags:2|(1<<20),actions:['View tab'],color:0x3b3022}));
    add(C.BANK_TAB_LABEL_START+i,tabs,text(i*43,0,40,28,{text:i?'Tab '+i:'Main',flags:2|(1<<20),actions:['View tab'],xTextAlignment:1,yTextAlignment:1}));
  }
  for(let i=0;i<BANK_SLOTS;i++) {
    const x=8+i%BANK_COLUMNS*BANK_PITCH_X,y=Math.floor(i/BANK_COLUMNS)*BANK_PITCH_Y;
    graphic(C.BANK_START+i,bank,x,y,36,32,{adminContainer:'bank',...slotOptions(),...hide});
    add(C.BANK_FRAME_START+i,bank,box(x,y,36,32,{adminContainerFrame:'bank',filled:false,color:0x806845,...hide}));
  }
}
function actionsFor(occupied,label='') {
  const suffix=label?' '+label:'';
  return occupied?['Set quantity','Add quantity','Remove quantity','Remove stack'].map(action=>action+suffix):['Add item'+suffix];
}
function slotOptions() { return {flags:SLOT_FLAGS,actions:actionsFor(false),itemQuantityMode:1,outline:1,spriteShadow:0x333333,
  dragZoneSize:5,dragThreshold:6}; }
module.exports={C,BANK_SLOTS,BANK_COLUMNS,BANK_PITCH_Y,EQUIPMENT,slotFor,slotComponents,actionsFor,build};
