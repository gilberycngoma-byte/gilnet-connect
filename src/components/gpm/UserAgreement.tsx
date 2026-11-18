import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  hasAcceptedUserAgreement,
  recordUserAgreementAcceptance,
  USER_AGREEMENT_VERSION,
} from "@/lib/user-agreement";
import { fetchGpmAppContent, type GpmAppContent } from "@/lib/gpm-app-content";

const sections = [
  {
    title: "1. ACCEPTANCE OF TERMS",
    paragraphs: [
      "By downloading, installing, or logging into GILNET CONNECT with your 6-digit PIN, you agree to this User Agreement. If you do not agree, do not use the app.",
    ],
  },
  {
    title: "2. SERVICE DESCRIPTION",
    paragraphs: [
      "GILNET CONNECT is a Property and Guest Management Platform (GPM) built for lodges, hotels, guest houses and serviced apartments in Zambia. It manages rooms, bookings, guest check-in/out, staff, billing and reports with offline capability.",
    ],
  },
  {
    title: "3. USER ACCOUNTS & SECURITY",
    paragraphs: [
      "3.1 Property Admin is responsible for creating and managing all staff accounts.",
      "3.2 You must keep your 6-digit PIN confidential.",
      "3.3 Any action performed under your PIN is your responsibility.",
      "3.4 GILNET CONNECT may suspend accounts suspected of misuse.",
    ],
  },
  {
    title: "4. DATA PROTECTION & PRIVACY",
    paragraphs: [
      "4.1 Data synchronized with Supabase is transmitted over encrypted connections. Offline data is cached on your device; keep your device secure.",
      "4.2 Guest data remains property of the Property Owner.",
      "4.3 GILNET CONNECT will never sell or share guest data with third parties.",
      "4.4 The service complies with Zambia Data Protection Act No. 3 of 2021.",
      "4.5 Properties must obtain guest consent before collecting personal information.",
    ],
  },
  {
    title: "5. FEES & SUBSCRIPTIONS",
    paragraphs: [
      "5.1 The subscription belongs to the registered property (for example, GILNET Lodge). The property is responsible for the subscription fees in ZMW, which are charged to the property's account using its nominated billing contact and payment method.",
      "5.2 Staff and other users registered under a property use GILNET CONNECT on behalf of that property. Their logins are not separate subscriptions, and the property's subscription fees are not charged to staff members' personal accounts. The Property Admin is responsible for managing the property subscription and its billing details.",
      "5.3 Subscription payments help us operate, support, maintain and improve GILNET CONNECT. The property agrees to pay by the due date so we can continue serving it. Non-payment after 7 days may lead to account suspension.",
      "5.4 No refunds are provided for partial-month usage.",
    ],
  },
  {
    title: "6. ACCEPTABLE USE",
    paragraphs: [
      "You agree not to use the app for illegal activities, attempt to hack or reverse-engineer the app, share the APK outside authorized staff, or enter false guest information.",
    ],
  },
  {
    title: "7. SYSTEM AVAILABILITY",
    paragraphs: [
      "7.1 The app works offline and syncs when internet is available.",
      "7.2 We aim for high uptime but do not guarantee 100% availability.",
      "7.3 Report all bugs to support.gilnet.property.manager@gmail.com within 24 hours.",
    ],
  },
  {
    title: "8. LIMITATION OF LIABILITY",
    paragraphs: [
      "GILNET CONNECT is not liable for loss of bookings, revenue, or data due to device loss, staff error, internet or power outage. Maximum liability is limited to 3 months subscription fees paid.",
    ],
  },
  {
    title: "9. TERMINATION",
    paragraphs: [
      "9.1 You may terminate with 30 days written notice via email.",
      "9.2 We may terminate immediately for breach, non-payment or illegal use.",
      "9.3 Data will be available for export for 14 days after termination, then permanently deleted.",
    ],
  },
  {
    title: "10. STAFF RESPONSIBILITY",
    paragraphs: [
      "The Property Admin is fully liable for all actions performed by their staff accounts.",
    ],
  },
  {
    title: "11. APP IP ADDRESS AND LOGO",
    paragraphs: [
      "11.1 App Package Name: com.gilnet.gpmconnect",
      "11.2 Server: supabase.com",
      "11.3 Logo: The GILNET CONNECT logo, icon and brand name are the exclusive intellectual property of GILNET CONNECT, Ndola. No copying or unauthorized use is permitted.",
      "11.4 All data traffic between the app and supabase.com is encrypted.",
    ],
  },
  {
    title: "12. CHANGES TO TERMS",
    paragraphs: [
      "We may update this agreement with 7 days notice via email or in-app notification. Continued use constitutes acceptance.",
    ],
  },
  {
    title: "13. CONTACT",
    paragraphs: [
      "GILNET CONNECT, Ndola, Zambia",
      "Email: support.gilnet.property.manager@gmail.com",
    ],
  },
];

function AgreementDialog({
  open,
  required,
  error,
  agreementText,
  effectiveDate,
  onOpenChange,
  onAccept,
}: {
  open: boolean;
  required: boolean;
  error?: string;
  agreementText: string;
  effectiveDate: string;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={required ? () => undefined : onOpenChange}>
      <DialogContent
        className={`grid max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden ${
          required ? "[&>button]:hidden" : ""
        }`}
      >
        <DialogHeader>
          <DialogTitle>GILNET CONNECT USER AGREEMENT</DialogTitle>
          <DialogDescription>
            Company: GILNET CONNECT · Location: Ndola, Zambia · Effective Date: {effectiveDate} ·
            App ID: com.gilnet.gpmconnect
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto border-y py-4 pr-2 text-sm">
          {renderAgreementText(agreementText)}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="gap-3 sm:justify-between">
          <Button type="button" onClick={onAccept}>
            {required ? "I AGREE" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UserAgreementGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [content, setContent] = useState<GpmAppContent | null>(null);

  useEffect(() => {
    let active = true;
    void fetchGpmAppContent()
      .then((appContent) => {
        if (!active) return;
        setContent(appContent);
        const version = appContent
          ? `${USER_AGREEMENT_VERSION}:${appContent.agreement_revision}`
          : USER_AGREEMENT_VERSION;
        setAccepted(hasAcceptedUserAgreement(window.localStorage, version));
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          `The latest User Agreement could not be loaded. Showing the bundled agreement. ${cause instanceof Error ? cause.message : ""}`,
        );
        try {
          setAccepted(hasAcceptedUserAgreement(window.localStorage));
        } catch (storageError: unknown) {
          setError(
            storageError instanceof Error
              ? storageError.message
              : "Could not read agreement acceptance.",
          );
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const accept = () => {
    try {
      const version = content
        ? `${USER_AGREEMENT_VERSION}:${content.agreement_revision}`
        : USER_AGREEMENT_VERSION;
      recordUserAgreementAcceptance(window.localStorage, version);
      setError("");
      setAccepted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save agreement acceptance.");
    }
  };

  if (!ready) {
    return <div className="min-h-screen bg-background" aria-busy="true" />;
  }
  if (accepted) return <>{children}</>;

  return (
    <AgreementDialog
      open
      required
      error={error}
      agreementText={content?.agreement_text ?? defaultAgreementText()}
      effectiveDate={content?.agreement_effective_date ?? "1 January 2027"}
      onOpenChange={() => undefined}
      onAccept={accept}
    />
  );
}

export function UserAgreementReviewButton() {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<GpmAppContent | null>(null);
  const [contentError, setContentError] = useState("");
  useEffect(() => {
    let active = true;
    void fetchGpmAppContent()
      .then((appContent) => {
        if (active) setContent(appContent);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setContent(null);
        setContentError(
          `The latest User Agreement could not be loaded. Showing the bundled agreement. ${cause instanceof Error ? cause.message : ""}`,
        );
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        View User Agreement
      </Button>
      <AgreementDialog
        open={open}
        required={false}
        error={contentError}
        agreementText={content?.agreement_text ?? defaultAgreementText()}
        effectiveDate={content?.agreement_effective_date ?? "1 January 2027"}
        onOpenChange={setOpen}
        onAccept={() => setOpen(false)}
      />
    </>
  );
}

function defaultAgreementText(): string {
  return [
    sections.map((section) => [section.title, ...section.paragraphs].join("\n\n")).join("\n\n"),
    "By tapping “I AGREE” you confirm you have read, understood and accepted this agreement.",
  ].join("\n\n");
}

function renderAgreementText(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      if (/^\d+\.\s/.test(block)) {
        return (
          <h2 key={`${index}-${block}`} className="font-semibold">
            {block}
          </h2>
        );
      }
      return (
        <p key={`${index}-${block}`} className="text-muted-foreground">
          {block}
        </p>
      );
    });
}
