import type { Notice } from "./types";

export function countUnreadNotices(
  list: Notice[],
  role: string | undefined,
  receiveCheckInNotices: boolean,
  userEmail: string,
) {
  const now = Date.now();
  const alive = list.filter(
    (notice) =>
      (!notice.expiry_date || new Date(notice.expiry_date).getTime() + 86400000 > now) &&
      (!notice.is_check_in_notice || receiveCheckInNotices),
  );
  const visible =
    role === "Housekeeping" || role === "Maintenance"
      ? alive.filter(
          (notice) => notice.to_department === role || notice.to_department === "All Staff",
        )
      : alive;
  return visible.filter((notice) => !notice.is_completed && !notice.seen_by?.includes(userEmail))
    .length;
}
