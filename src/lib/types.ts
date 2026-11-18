export type Role = "Admin" | "Manager" | "Supervisor" | "Front Desk" | "Housekeeping" | "Maintenance" | "Restaurant";
export const ROLES: Role[] = ["Admin", "Manager", "Supervisor", "Front Desk", "Housekeeping", "Maintenance", "Restaurant"];
export const MANAGER_ROLES: Role[] = ["Admin", "Manager", "Supervisor"];
export const DESK_ROLES: Role[] = ["Admin", "Manager", "Supervisor", "Front Desk"];
export const STAFF_DEPARTMENTS = [
  "Housekeeping",
  "Food and Beverage",
  "Front Office",
  "Human Resource",
  "Maintenance",
  "Security",
  "Admin",
] as const;
export type StaffDepartment = (typeof STAFF_DEPARTMENTS)[number];
export const STAFF_DEPARTMENT_VALUES = STAFF_DEPARTMENTS;
export const PROPERTY_TYPES = ["Hotel", "Motel", "Lodge", "Guest House", "Apartments"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
/** Chat/notice department a role belongs to. */
export const deptForRole = (r?: Role | string): Department =>
  r === "Admin" || r === "Manager" || r === "Supervisor" ? "Management" : ((r as Department) ?? "Front Desk");

export const DEPARTMENTS = [
  "Front Desk",
  "Housekeeping",
  "Maintenance",
  "Restaurant",
  "Management",
  "All Staff",
  "GILNET Assistant",
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export type User = {
  id: string;
  name: string;
  email: string;
  loginIdentifier?: string;
  username: string;
  password: string; // base64
  role: Role;
  department?: string;
  isStaffMember?: boolean;
};

export type Property = {
  name: string;
  address: string;
  phone: string;
  property_type?: string;
  billing_email?: string | null;
  image_url?: string | null;
  profile_image_url?: string | null;
  created_by?: string | null;
};

export type RoomStatus = "Available" | "Occupied" | "Dirty" | "Cleaning" | "Out of Order";
export type Room = {
  number: string;
  type: string;
  status: RoomStatus;
  floor?: string;
  price?: number;
  guestName?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  reservationId?: string | null;
  dnd?: boolean;
  /** Date (YYYY-MM-DD) housekeeping last serviced an occupied room. */
  serviced_at?: string | null;
  pax?: number | null;
};

export type ReservationStatus =
  | "Reserved"
  | "Confirmed Check-In"
  | "Cancelled"
  | "Checked-Out"
  | "No-Show";
export type PaymentPlan = "Full" | "Partial" | "Pay Later";
export type StayExtension = {
  from_date: string;
  from_time: string | null;
  to_date: string;
  to_time: string;
  changed_at: string;
  changed_by: string;
  changed_role: string;
  reason: string;
};
export type Reservation = {
  id: string;
  property_code: string;
  guest_name: string;
  room_number: string | null;
  preferred_room: string | null;
  check_in_date: string;
  check_out_date: string;
  num_guests: number;
  status: ReservationStatus;
  payment_status: string;
  total_amount: number;
  confirmed_by: string | null;
  confirmed_at: string | null;
  check_out_time?: string | null;
  checked_out_at?: string | null;
  checked_out_by?: string | null;
  checked_out_role?: string | null;
  stay_extensions?: StayExtension[];
  payment_plan?: PaymentPlan;
  payment_due_date?: string | null;
  payment_reason?: string | null;
  cancellation_reason: string | null;
  noShowReason: string | null;
  noShowFee: number | null;
  noShowAt: string | null;
  created_at: string;
  // Front-desk walk-in details (optional for older records).
  phone?: string | null;
  rate?: number | null;
  amount_paid?: number | null;
  payment_method?: string | null;
  receipt_no?: string | null;
  notes?: string | null;
  discount?: number | null;
  confirmed_role?: string | null;
};

export type NoticeType = "Urgent" | "Maintenance" | "Instruction" | "Info" | "Task";
export type Priority = "Low" | "Medium" | "High" | "Urgent";
export type Notice = {
  id: string;
  number: number;
  property_code: string;
  title: string;
  message: string;
  type: NoticeType;
  to_department: Department;
  from_user: string;
  from_department: string;
  priority: Priority;
  is_pinned: boolean;
  is_completed: boolean;
  completed_by: string | null;
  completed_photo: string | null;
  audio_url: string | null;
  photo: string | null;
  expiry_date: string | null;
  seen_by: string[];
  created_at: string;
  is_check_in_notice?: boolean;
};

export type MessageType = "chat" | "notice_alert" | "task" | "bot" | "voice";
export type MessageReceiverType = "all_staffs" | "department" | "individual";
export type Message = {
  id: string;
  property_code: string;
  sender_id?: string | null;
  sender_staff_id?: string | null;
  recipient_type?: MessageReceiverType;
  receiver_type?: MessageReceiverType | "all" | "specific";
  receiver_id?: string | null;
  receiver_staff_id?: string | null;
  receiver_staff_name?: string | null;
  from_department: string;
  to_department: Department;
  from_user: string;
  message: string;
  room_number: string | null;
  notice_id: string | null;
  message_type: MessageType;
  is_read: boolean;
  is_pinned?: boolean;
  audio_url: string | null;
  audio_duration: number | null;
  transcription: string | null;
  image?: string | null;
  created_at: string;
};
