import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "./account";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return <AccountPage title="Settings" />;
}
