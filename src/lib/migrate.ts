import { keys, read, write } from "./db";
import { APP_VERSION } from "./version";
import type { Reservation, Room } from "./types";

export function defaultRooms(): Room[] {
  const rooms: Room[] = Array.from({length:15},(_,i)=>({number:String(i+1),type:'Standard',floor:'1',price:0,status:'Available'}));
  return rooms;
}

/** Adds missing fields to older local data. Never deletes or renames anything. */
export function migrateLocalData(code: string) {
  try {
    const rooms = read<Room[] | null>(keys.rooms(code), null);
    // Rooms are provisioned atomically in Cloud first-time setup.

    const res = read<Partial<Reservation>[]>(keys.reservations(code), []);
    const fixed = res.map((r) => ({
      status: "Reserved",
      confirmed_by: null,
      confirmed_at: null,
      cancellation_reason: null,
      noShowReason: null,
      noShowFee: null,
      noShowAt: null,
      preferred_room: null,
      payment_status: "Pending",
      total_amount: 0,
      num_guests: 1,
      ...r,
    }));
    write(keys.reservations(code), fixed);
    write(keys.appVersion(code), APP_VERSION);
  } catch (e) {
    console.warn("GILNET migration skipped", e);
  }
}
