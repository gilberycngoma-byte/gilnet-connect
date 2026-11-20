import { Link } from "@tanstack/react-router";
import { CalendarCheck, Megaphone, MessageSquare, type LucideIcon } from "lucide-react";
import { keys, useStored } from "@/lib/db";
import { countUnreadNotices } from "@/lib/notice-visibility";
import type { AppPreferences } from "@/lib/app-preferences";
import type { Notice, Role } from "@/lib/types";

type FloatingActionBubblesProps = {
  propertyCode: string;
  role: Role;
  userEmail: string;
  messageUnread: number;
  preferences: AppPreferences;
};

type BubbleLinkProps = {
  to: "/attendance" | "/messages" | "/notices";
  label: string;
  icon: LucideIcon;
  unread?: number;
};

function BubbleLink({ to, label, icon: Icon, unread = 0 }: BubbleLinkProps) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={unread > 0 ? `${label}, ${unread} unread` : label}
      className="relative grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Icon aria-hidden="true" className="h-5 w-5" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 min-w-5 rounded-full bg-destructive px-1 text-center text-[10px] font-bold leading-5 text-destructive-foreground"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

export function FloatingActionBubbles({
  propertyCode,
  role,
  userEmail,
  messageUnread,
  preferences,
}: FloatingActionBubblesProps) {
  const notices = useStored<Notice[]>(keys.notices(propertyCode), []);
  const noticeUnread = countUnreadNotices(notices, role, preferences.checkInNotices, userEmail);
  const anyEnabled =
    preferences.floatingAttendanceBubble ||
    preferences.floatingMessagesBubble ||
    preferences.floatingNoticesBubble;

  if (!anyEnabled) return null;

  return (
    <nav
      aria-label="Quick access bubbles"
      className="fixed bottom-20 right-3 z-30 flex flex-col gap-2 md:bottom-5 md:right-5"
    >
      {preferences.floatingAttendanceBubble && (
        <BubbleLink to="/attendance" label="Staff attendance" icon={CalendarCheck} />
      )}
      {preferences.floatingMessagesBubble && (
        <BubbleLink to="/messages" label="Messages" icon={MessageSquare} unread={messageUnread} />
      )}
      {preferences.floatingNoticesBubble && (
        <BubbleLink to="/notices" label="Notices" icon={Megaphone} unread={noticeUnread} />
      )}
    </nav>
  );
}
