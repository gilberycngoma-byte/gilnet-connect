import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { getCurrentUser, homeFor } from "@/lib/auth";
import { APP_NAME } from "@/lib/version";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: APP_NAME },
      { name: "description", content: `${APP_NAME} — offline-first hotel and property management: rooms, reservations, notices and staff chat.` },
      { property: "og:title", content: APP_NAME },
      { property: "og:description", content: "Offline-first property management for rooms, reservations, notices and staff chat." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    if (url.searchParams.get("type") === "recovery" || hashParams.get("type") === "recovery") {
      window.location.replace(`/login${url.search}${url.hash}`);
      return;
    }
    const s = getCurrentUser();
    navigate({ to: s ? homeFor(s.role) : "/login", replace: true });
  }, [navigate]);
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <img src="/gilnet-logo.png" alt={APP_NAME} width={160} height={160} className="animate-pulse" />
    </div>
  );
}
