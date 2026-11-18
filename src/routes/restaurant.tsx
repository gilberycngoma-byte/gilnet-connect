import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Download, Plus, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/gpm/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { can, useSession } from '@/lib/auth';
import { keys, uid, useStored, write } from '@/lib/db';
import { PAYMENT_METHODS, money, roomLabel, sortRooms } from '@/lib/payments';
import { SERVICES, deleteSale, saleDate, saleRevenue, settleOrder, updateSale, type MenuItem, type Sale, type SaleMethod, type Service } from '@/lib/restaurant';
import { generateRestaurantReceiptPdf } from '@/lib/restaurantReceipt';
import type { Property, Room } from '@/lib/types';
import { APP_NAME } from '@/lib/version';

export const Route=createFileRoute('/restaurant')({head:()=>({meta:[{title:`Restaurant / POS - ${APP_NAME}`},{name:'description',content:'Record restaurant, bar and laundry sales with cash, mobile, card, bank or complimentary payment.'},{property:'og:title',content:'GILNET Restaurant / POS'},{property:'og:description',content:'Daily restaurant sales and guest room charges.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:Restaurant});

const field='mt-1 w-full rounded-md border bg-card px-3 py-2 text-sm';
const L=({htmlFor,children}:{htmlFor:string;children:string})=><Label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</Label>;

function Restaurant(){
 const session=useSession();const code=session?.property_code??'';const role=session?.role;
 const property=useStored<Property|null>(keys.property(code),null);
 const menu=useStored<MenuItem[]>(keys.menu(code),[]);const sales=useStored<Sale[]>(keys.sales(code),[]);const rooms=sortRooms(useStored<Room[]>(keys.rooms(code),[]));
 const today=new Date().toISOString().slice(0,10);const month=today.slice(0,7);
 const [service,setService]=useState<Service>('Restaurant');const [date,setDate]=useState(today);const [itemId,setItemId]=useState('');const [custom,setCustom]=useState('');const [comment,setComment]=useState('');
 const [qty,setQty]=useState('1');const [price,setPrice]=useState('0');const [room,setRoom]=useState('');const [method,setMethod]=useState<SaleMethod>('Cash');const [receiptNo,setReceiptNo]=useState('');
 const [editing,setEditing]=useState<Sale|null>(null);const [menuOpen,setMenuOpen]=useState(false);
 const occupied=rooms.filter(r=>r.status==='Occupied');
 const total=method==='Complimentary'?0:Math.round((Number(qty)||0)*(Number(price)||0)*100)/100;
 const sum=(list:Sale[])=>list.reduce((t,s)=>t+saleRevenue(s),0);
 const monthSales=sales.filter(s=>saleDate(s).startsWith(month)).sort((a,b)=>saleDate(b).localeCompare(saleDate(a))||b.created_at.localeCompare(a.created_at));
 const pickItem=(id:string)=>{setItemId(id);const m=menu.find(i=>i.id===id);if(m)setPrice(String(m.price));};
 const add=()=>{
  const name=itemId==='custom'?custom.trim():menu.find(i=>i.id===itemId)?.name??'';
  try{const sale=settleOrder([{name,price:Number(price)||0,quantity:Math.floor(Number(qty))||0}],method,room,{service,date,comments:comment,receipt_no:receiptNo});toast.success(`Sale added · Receipt ${sale.receipt_no}`);setItemId('');setCustom('');setQty('1');setPrice('0');setRoom('');setMethod('Cash');setReceiptNo('');setComment('');}
  catch(e){toast.error((e as Error).message);}
 };
 const downloadReceipt=(sale:Sale)=>{
  try{const receipt=generateRestaurantReceiptPdf(property?.name??code,sale);receipt.doc.save(receipt.filename);}
  catch(e){toast.error((e as Error).message);}
 };
 const printReceipt=(sale:Sale)=>{
  try{const receipt=generateRestaurantReceiptPdf(property?.name??code,sale);receipt.doc.autoPrint();const opened=window.open(receipt.doc.output('bloburl'),'_blank');if(!opened)toast.error('Allow pop-ups to print this receipt.');}
  catch(e){toast.error((e as Error).message);}
 };
 return <AppShell title="Restaurant" allow="restaurant">
  <div className="mb-6 grid gap-4 sm:grid-cols-2">
   {[['Sales today',sum(sales.filter(s=>saleDate(s)===today))],['Sales this month',sum(monthSales)]].map(([l,v])=><div key={l as string} className="rounded-2xl border bg-card p-5 shadow-sm"><p className="text-sm text-muted-foreground">{l}</p><p className="mt-2 text-3xl font-bold">{money(v as number)}</p></div>)}
  </div>
  <section className="rounded-2xl border bg-card p-5 shadow-sm">
   <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
    <div><L htmlFor="svc">Service</L><select id="svc" className={field} value={service} onChange={e=>setService(e.target.value as Service)}>{SERVICES.map(s=><option key={s}>{s}</option>)}</select></div>
    <div><L htmlFor="dt">Date</L><Input id="dt" className="mt-1" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
    <div className="lg:col-span-2"><L htmlFor="it">Item</L><select id="it" className={field} value={itemId} onChange={e=>pickItem(e.target.value)}><option value="">Choose item…</option>{menu.filter(m=>m.category===service||(service==='Restaurant'&&!['Bar','Room Service','Laundry'].includes(m.category))).map(m=><option key={m.id} value={m.id}>{m.name} · {money(m.price)}</option>)}<option value="custom">Other item…</option></select>{itemId==='custom'&&<Input aria-label="Item name" className="mt-2" placeholder="Item name" value={custom} onChange={e=>setCustom(e.target.value)}/>}</div>
    <div><L htmlFor="qt">Qty</L><Input id="qt" className="mt-1" type="number" min="1" value={qty} onChange={e=>setQty(e.target.value)}/></div>
    <div><L htmlFor="pr">Price (K)</L><Input id="pr" className="mt-1" type="number" min="0" value={price} onChange={e=>setPrice(e.target.value)}/></div>
    <div><L htmlFor="rw">Room / Walk-in</L><select id="rw" className={field} value={room} onChange={e=>{setRoom(e.target.value);if(!e.target.value&&method==='Room Charge')setMethod('Cash');}}><option value="">Walk-in</option>{occupied.map(r=><option key={r.number} value={r.number}>Room {roomLabel(r.number)} · {r.guestName}</option>)}</select></div>
    <div><L htmlFor="pay">Payment</L><select id="pay" className={field} value={method} onChange={e=>setMethod(e.target.value as SaleMethod)}>{PAYMENT_METHODS.map(m=><option key={m}>{m}</option>)}{room&&<option value="Room Charge">Charge to room bill</option>}</select></div>
    <div><L htmlFor="receipt">Receipt number (optional)</L><Input id="receipt" className="mt-1" maxLength={64} placeholder="Blank uses the next number" value={receiptNo} onChange={e=>setReceiptNo(e.target.value)}/></div>
    <div className="lg:col-span-3"><Label htmlFor="sale-comment">Comments (optional)</Label><Textarea id="sale-comment" className="mt-1" value={comment} onChange={e=>setComment(e.target.value)} /></div>
    <div className="flex items-end gap-4 lg:col-span-3"><p className="pb-2 font-semibold">Total: {money(total)}</p><Button className="rounded-full px-6" disabled={!itemId||(itemId==='custom'&&!custom.trim())} onClick={add}>Add sale</Button></div>
   </div>
  </section>
  <section className="mt-6 rounded-2xl border bg-card p-5 shadow-sm">
   <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">This month's sales</h2>{can(role,'menu_manage')&&<Button size="sm" variant="outline" onClick={()=>setMenuOpen(true)}>Manage menu items</Button>}</div>
   <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b text-muted-foreground"><tr>{['Date','Item','Service','Qty','Room','Payment','Total','Receipt No','Actions'].map(h=><th key={h} className="p-3 font-semibold">{h}</th>)}</tr></thead>
    <tbody>{!monthSales.length&&<tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No sales this month yet.</td></tr>}
     {monthSales.map(s=><tr key={s.id} className="border-b"><td className="p-3">{saleDate(s)}</td><td className="p-3">{s.items.map(i=>i.name).join(', ')}</td><td className="p-3">{s.service??'Restaurant'}</td><td className="p-3">{s.items.reduce((q,i)=>q+i.quantity,0)}</td><td className="p-3">{s.room_number?roomLabel(s.room_number):'Walk-in'}</td><td className="p-3">{s.method==='Card'?'Visa/Card':s.method}</td><td className="p-3 font-semibold">{money(s.total)}</td><td className="p-3">{s.receipt_no?.trim()||s.id}</td>
      <td className="p-3"><div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="outline" onClick={()=>downloadReceipt(s)}><Download className="h-4 w-4"/> Receipt PDF</Button><Button size="sm" variant="outline" onClick={()=>printReceipt(s)}><Printer className="h-4 w-4"/> Print</Button>{can(role,'sale_edit')&&<><button className="text-primary" onClick={()=>setEditing(s)}>Edit</button><button className="text-destructive" onClick={()=>{if(window.confirm('Delete this sale?')){try{deleteSale(s.id);}catch(e){toast.error((e as Error).message);}}}}>Delete</button></>}</div></td></tr>)}
    </tbody></table></div>
  </section>
  <EditSale sale={editing} onClose={()=>setEditing(null)}/>
  <MenuDialog open={menuOpen} onOpenChange={setMenuOpen} menu={menu} code={code}/>
 </AppShell>;
}

function EditSale({sale,onClose}:{sale:Sale|null;onClose:()=>void}){
 const [items,setItems]=useState<Sale['items']>([]);const [method,setMethod]=useState<SaleMethod>('Cash');
 useEffect(()=>{if(sale){setItems(sale.items.map(item=>({...item})));setMethod(sale.method==='Card'?'Visa/Card':sale.method);}},[sale]);
 const updateItem=(index:number,patch:Partial<Sale['items'][number]>)=>setItems(current=>current.map((item,i)=>i===index?{...item,...patch}:item));
 const valid=items.length>0&&items.every(item=>item.name.trim()&&Number.isInteger(item.quantity)&&item.quantity>=1&&Number.isFinite(item.price)&&item.price>=0);
 return <Dialog open={!!sale} onOpenChange={o=>{if(!o)onClose();}}><DialogContent className="rounded-3xl"><DialogHeader><DialogTitle>Edit sale</DialogTitle></DialogHeader>
  {items.map((item,index)=><div key={index} className="space-y-2 rounded-xl border p-3">
   <Label htmlFor={`e-n-${index}`}>Item {index+1}</Label><Input id={`e-n-${index}`} value={item.name} onChange={e=>updateItem(index,{name:e.target.value})}/>
   <div className="grid grid-cols-2 gap-3"><div><Label htmlFor={`e-q-${index}`}>Qty</Label><Input id={`e-q-${index}`} type="number" min="1" step="1" value={item.quantity} onChange={e=>updateItem(index,{quantity:Number(e.target.value)})}/></div><div><Label htmlFor={`e-p-${index}`}>Price (K)</Label><Input id={`e-p-${index}`} type="number" min="0" step="0.01" value={item.price} onChange={e=>updateItem(index,{price:Number(e.target.value)})}/></div></div>
  </div>)}
  <Label htmlFor="e-m">Payment</Label><select id="e-m" className={field} value={method} onChange={e=>setMethod(e.target.value as SaleMethod)}>{PAYMENT_METHODS.map(m=><option key={m}>{m}</option>)}{sale?.room_number&&<option value="Room Charge">Charge to room bill</option>}</select>
  <Button disabled={!valid} onClick={()=>{if(!sale)return;try{updateSale(sale.id,{method,items:items.map(item=>({...item,name:item.name.trim()}))});onClose();}catch(e){toast.error((e as Error).message);}}}>Save changes</Button>
 </DialogContent></Dialog>;
}

function MenuDialog({open,onOpenChange,menu,code}:{open:boolean;onOpenChange:(o:boolean)=>void;menu:MenuItem[];code:string}){
 const [name,setName]=useState('');const [price,setPrice]=useState('');const [category,setCategory]=useState<string>('Restaurant');
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl"><DialogHeader><DialogTitle>Menu items</DialogTitle></DialogHeader>
  <ul className="space-y-1">{menu.map(i=><li key={i.id} className="flex items-center justify-between rounded-lg bg-brand-soft px-3 py-2 text-sm"><span>{i.name} · {i.category} · {money(i.price)}</span><Button size="icon" variant="ghost" aria-label={`Delete ${i.name}`} onClick={()=>write(keys.menu(code),menu.filter(m=>m.id!==i.id))}><Trash2/></Button></li>)}{!menu.length&&<li className="text-sm text-muted-foreground">No items yet.</li>}</ul>
  <Label htmlFor="m-n">Item name</Label><Input id="m-n" value={name} onChange={e=>setName(e.target.value)}/>
  <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="m-c">Service</Label><select id="m-c" className={field} value={category} onChange={e=>setCategory(e.target.value)}>{SERVICES.map(s=><option key={s}>{s}</option>)}</select></div><div><Label htmlFor="m-p">Price (K)</Label><Input id="m-p" type="number" min="0" value={price} onChange={e=>setPrice(e.target.value)}/></div></div>
  <Button disabled={!name.trim()||price===''||Number(price)<0} onClick={()=>{write(keys.menu(code),[...menu,{id:uid(),name:name.trim(),category,price:Number(price)}]);setName('');setPrice('');}}><Plus/> Add item</Button>
 </DialogContent></Dialog>;
}
