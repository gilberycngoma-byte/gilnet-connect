import { keys, read, uid, write } from './db';
import { getCurrentUser, can } from './auth';
import { nextReceiptNo } from './payments';
import type { Property, Reservation, Room } from './types';
import { reservationTotal } from './payments';
export type MenuItem={id:string;name:string;category:string;price:number};
export const SERVICES=['Restaurant','Bar','Room Service'] as const;
export type Service=(typeof SERVICES)[number]|'Laundry';
/** 'Room Charge' adds to the guest bill; other methods are settled immediately. 'Card' is kept for older sales. */
export type SaleMethod='Cash'|'Mobile'|'Visa/Card'|'Bank'|'Complimentary'|'Room Charge'|'Card';
export type Sale={id:string;items:{name:string;price:number;quantity:number}[];total:number;method:SaleMethod;room_number:string|null;reservation_id:string|null;created_at:string;staff:string;service?:Service;date?:string;receipt_no?:string|null;comments?:string|null};
export function orderTotal(items:Sale['items']){return Math.round(items.reduce((sum,i)=>sum+i.price*i.quantity,0)*100)/100;}
export const saleDate=(s:Sale)=>s.date??s.created_at.slice(0,10);
export const saleRevenue=(s:Sale)=>s.method==='Complimentary'?0:s.total;
function occupied(code:string,roomNumber:string){return read<Room[]>(keys.rooms(code),[]).find(r=>r.number===roomNumber&&r.status==='Occupied'&&r.reservationId);}
function validItems(items:Sale['items']){return items.length>0&&items.every(i=>typeof i.name==='string'&&!!i.name.trim()&&Number.isFinite(i.quantity)&&Number.isInteger(i.quantity)&&i.quantity>=1&&Number.isFinite(i.price)&&i.price>=0);}
export function settleOrder(items:Sale['items'],method:SaleMethod,roomNumber:string,extra:{service?:Service;date?:string;comments?:string;receipt_no?:string}={}){
 const s=getCurrentUser();const permitted=extra.service==='Laundry'?can(s?.role,'frontdesk'):can(s?.role,'restaurant');if(!s||!permitted)throw new Error('You cannot record sales.');
 if(!validItems(items))throw new Error('Add valid items to the order.');
 const room=roomNumber?occupied(s.property_code,roomNumber):undefined;
 if(method==='Room Charge'&&!room)throw new Error('Select an occupied guest room.');
 const total=method==='Complimentary'?0:orderTotal(items);
 const existingSales=read<Sale[]>(keys.sales(s.property_code),[]);
 const reservations=read<Reservation[]>(keys.reservations(s.property_code),[]);
 const property=read<Property|null>(keys.property(s.property_code),null);
 const manualReceiptNo=extra.receipt_no?.trim()??'';
 if(manualReceiptNo.length>64)throw new Error('Receipt numbers must be 64 characters or fewer.');
 const usedReceiptNumbers=[
  ...reservations.map(reservation=>reservation.receipt_no),
  ...existingSales.map(existingSale=>existingSale.receipt_no),
 ];
 if(manualReceiptNo&&usedReceiptNumbers.some(receipt=>receipt?.trim().toLowerCase()===manualReceiptNo.toLowerCase()))throw new Error('That receipt number has already been used.');
 const receiptNo=manualReceiptNo||nextReceiptNo(property?.name??s.property_code,usedReceiptNumbers);
 const sale:Sale={id:uid(),items,total,method,room_number:room?roomNumber:null,reservation_id:room?.reservationId??null,created_at:new Date().toISOString(),staff:s.user_name,service:extra.service??'Restaurant',receipt_no:receiptNo,...(extra.date?{date:extra.date}:{}),...(extra.comments?.trim()?{comments:extra.comments.trim()}:{})};
 write(keys.sales(s.property_code),[sale,...existingSales]);
 return sale;
}
export function updateSale(id:string,patch:Partial<Sale>){
 const s=getCurrentUser();if(!s||!can(s.role,'sale_edit'))throw new Error('Only a manager or supervisor can edit sales.');
 if(patch.items&&!validItems(patch.items))throw new Error('Add valid items to the order.');
 const list=read<Sale[]>(keys.sales(s.property_code),[]);
 if(!list.some(x=>x.id===id))throw new Error('Sale not found.');
 write(keys.sales(s.property_code),list.map(x=>{if(x.id!==id)return x;const next={...x,...patch};return {...next,total:next.method==='Complimentary'?0:orderTotal(next.items)};}));
}
export function deleteSale(id:string){
 const s=getCurrentUser();if(!s||!can(s.role,'sale_edit'))throw new Error('Only a manager or supervisor can delete sales.');
 write(keys.sales(s.property_code),read<Sale[]>(keys.sales(s.property_code),[]).filter(x=>x.id!==id));
}
export function roomFolio(reservation:Reservation,sales:Sale[]){return reservationTotal(reservation)+sales.filter(s=>s.method==='Room Charge'&&s.reservation_id===reservation.id).reduce((sum,s)=>sum+s.total,0);}
