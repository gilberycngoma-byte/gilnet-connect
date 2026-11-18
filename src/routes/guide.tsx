import { createFileRoute } from "@tanstack/react-router";
import { FirstTimeGuide } from "@/components/gpm/FirstTimeGuide";

export const Route = createFileRoute("/guide")({
  component: FirstTimeGuide,
});
