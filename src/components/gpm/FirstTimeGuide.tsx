import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  CircleHelp,
  Cloud,
  LockKeyhole,
  MessageSquareText,
  Smartphone,
} from "lucide-react";
import { AppShell } from "@/components/gpm/AppShell";
import { can, homeFor, useSession } from "@/lib/auth";
import { SUPPORT_EMAIL } from "@/lib/version";

function GuideSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function FirstTimeGuide() {
  const session = useSession();
  const isManager = can(session?.role, "users");
  const canWorkFrontDesk = can(session?.role, "frontdesk");
  const canWorkHousekeeping = can(session?.role, "housekeeping");
  const canWorkRestaurant = can(session?.role, "restaurant");

  const content = (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b2b47] via-[#0d4960] to-[#0b6970] p-6 text-white sm:p-8">
        <BookOpen className="h-8 w-8 text-white/80" aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Welcome to GILNET GPM CONNECT</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">
          A practical guide to signing in, finding your work, communicating with your team, and
          keeping changes safe when the internet is unavailable.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {session ? (
            <>
              <Link
                to={homeFor(session.role)}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#0b4960]"
              >
                Open my workspace <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                to="/messages"
                className="inline-flex items-center gap-2 rounded-full border border-white/40 px-4 py-2 text-sm font-semibold text-white"
              >
                Open messages
              </Link>
            </>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#0b4960]"
            >
              Go to sign in <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      </header>

      <GuideSection number="1" title="Before your first sign-in">
        <p>
          Your property administrator must create your account and tell you the property code,
          sign-in mode, and login details. Use your own account; actions are recorded under the
          signed-in staff member.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Management accounts use the management sign-in option; operational staff use staff
            sign-in.
          </li>
          <li>
            Enter the property code exactly as provided, then your username or email and password.
          </li>
          <li>Read and accept the current User Agreement when asked.</li>
          <li>
            Use “Remember my login” only on a device you control. Do not save login details on
            shared devices.
          </li>
        </ul>
        <p>
          Cloud sign-in needs an internet connection. If you have not been given an account, contact
          your property administrator rather than creating a shared staff login.
        </p>
      </GuideSection>

      <GuideSection number="2" title="Find your way around">
        <p>
          After sign-in, GILNET opens the workspace for your role. On a computer, use the operations
          menu on the left. On a phone, use the bottom navigation or open <strong>More</strong> to
          see every operation available to you.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Rooms Dashboard:</strong> review room status and available room actions.
          </li>
          <li>
            <strong>Bookings:</strong> search reservations, review dates and guest details, and use
            the actions allowed for your role.
          </li>
          <li>
            <strong>Tasks:</strong> read notices, find work for your department, and record progress
            or completion.
          </li>
          <li>
            <strong>Messages:</strong> communicate with the departments and people available to your
            account.
          </li>
          {canWorkRestaurant && (
            <li>
              <strong>Restaurant / POS:</strong> open restaurant operations and available sales
              tools.
            </li>
          )}
          {isManager && (
            <li>
              <strong>Staff Management, Attendance, and Reports:</strong> access team administration
              and reporting tools allowed for managers.
            </li>
          )}
        </ul>
        <p>
          Access depends on your property role. If an operation is missing or says it is not
          available to your role, ask a manager to review your access.
        </p>
      </GuideSection>

      <GuideSection number="3" title="Bookings and room operations">
        {canWorkFrontDesk ? (
          <>
            <p>For bookings assigned to your role:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Open{" "}
                <Link
                  className="font-medium text-primary underline"
                  to="/reservations"
                  search={{ add: false }}
                >
                  Bookings
                </Link>{" "}
                and locate the reservation.
              </li>
              <li>
                Check the guest name, dates, room assignment, and payment notes before changing its
                status.
              </li>
              <li>
                Use the appropriate confirm, check-in, cancel, or no-show action. Assign a room only
                after checking availability.
              </li>
              <li>
                At departure, complete the check-out action so the room can move to its next service
                state.
              </li>
            </ol>
            <p>
              A reservation is not the same as an occupied room. Follow the check-in flow rather
              than marking a room occupied just because a booking exists.
            </p>
          </>
        ) : (
          <p>
            Use the Rooms Dashboard or the workspace assigned to your role. Booking and room changes
            are available only to roles with permission; ask a manager if you need a booking
            updated.
          </p>
        )}
        {canWorkHousekeeping && (
          <p>
            Housekeeping staff can use the Housekeeping workspace to review room conditions and
            record cleaning work. Check the room after service before marking it ready.
          </p>
        )}
      </GuideSection>

      <GuideSection number="4" title="Tasks and notices">
        <p>
          Check the room or task details before starting work. Notices can include a department,
          priority, room reference, photos, or voice notes. Use the Tasks page to find relevant work
          and update it when your role permits.
        </p>
        {canWorkFrontDesk && (
          <p>
            Front desk staff can route a new issue to the appropriate department using a notice,
            then follow up in Messages when the team needs more context.
          </p>
        )}
        <p>
          Urgent issues should still be raised directly with the on-duty manager according to your
          property&apos;s procedures.
        </p>
      </GuideSection>

      <GuideSection number="5" title="Messages and team communication">
        <div className="flex items-start gap-3">
          <MessageSquareText className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p>
            Open Messages, choose the correct department or conversation, and keep messages factual
            and relevant to work. Use a notice for an actionable task that needs an owner or
            follow-up. Private messages are visible only to their intended participants.
          </p>
        </div>
        <p>
          Messages created offline are saved on this device and retried automatically. They sync
          under the account that created them so the sender identity stays accurate. If a message is
          waiting from another account, it remains safely queued until that sender signs in again;
          it is not sent as another staff member.
        </p>
      </GuideSection>

      <GuideSection number="6" title="Internet, offline work, and sync">
        <div className="flex items-start gap-3">
          <Cloud className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p>
            GILNET keeps local changes on the device when connectivity drops. When the internet
            returns, cloud sync retries in the background. The small sync status near the page
            heading shows whether work is pending or synced; do not clear app storage while changes
            are pending.
          </p>
        </div>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Reconnect to a reliable network and leave the app open briefly for background sync.
          </li>
          <li>
            Keep the same staff account active when syncing messages that account created offline.
          </li>
          <li>
            If a conflict review appears, compare both versions and choose which one to keep.
            Neither version is discarded until you choose.
          </li>
          <li>
            Backups are separate from routine sync. Managers can review the backup options in
            Settings.
          </li>
        </ul>
      </GuideSection>

      <GuideSection number="7" title="Your account, privacy, and payments">
        <div className="flex items-start gap-3">
          <LockKeyhole className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p>
            Use your own password and never share it. Sign out on shared devices, keep guest and
            staff information private, and ask a manager before changing account or property
            details. Admin and manager tools may be restricted by your role.
          </p>
        </div>
        <p>
          Settings and Account contain the profile, password, app preferences, and any backup
          options enabled for your role. Payment displays property subscription information; do not
          assume a charge or payment has completed unless your property administrator confirms that
          a payment provider is enabled.
        </p>
      </GuideSection>

      <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <CircleHelp className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h2 className="font-semibold">Need help?</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Ask your property administrator about access, bookings, or local procedures. Include
              the page name and a short description if you contact GILNET Support.
            </p>
            <div className="mt-3 flex flex-wrap gap-4">
              {session && (
                <Link
                  to="/settings"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-primary underline"
                >
                  Open Settings <Smartphone className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-sm font-semibold text-primary underline"
              >
                Email GILNET Support
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );

  if (session) return <AppShell title="First-time Guide">{content}</AppShell>;

  return <main className="min-h-screen bg-background px-3 py-6 sm:px-6 sm:py-8">{content}</main>;
}
