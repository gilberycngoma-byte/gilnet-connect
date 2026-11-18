import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentPage } from "./payment";

const mocks = vi.hoisted(() => ({
  fetchPropertySubscription: vi.fn(),
  selectPropertySubscriptionPlan: vi.fn(),
}));

vi.mock("@/components/gpm/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/lib/auth", () => ({
  can: () => true,
  useSession: () => ({ role: "Admin", property_code: "P001" }),
}));

vi.mock("@/lib/subscriptions", () => ({
  fetchPropertySubscription: mocks.fetchPropertySubscription,
  selectPropertySubscriptionPlan: mocks.selectPropertySubscriptionPlan,
}));

const subscriptionData = {
  property: { code: "P001", name: "GILNET Lodge", billingEmail: "billing@example.com" },
  plans: [
    {
      id: "plan-1",
      name: "Standard",
      price: 250,
      currency: "ZMW",
      billing_interval: "monthly",
      description: "For growing properties",
      features: ["Unlimited bookings", "Staff management"],
      recommended: true,
    },
  ],
  subscription: null,
};

describe("property subscription checkout preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchPropertySubscription.mockResolvedValue(subscriptionData);
    mocks.selectPropertySubscriptionPlan.mockResolvedValue(undefined);
  });

  it("opens the payment-style preview and saves only the selected plan", async () => {
    render(<PaymentPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Standard/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Payment method" })).toBeInTheDocument();
    expect(screen.getAllByText("K250 ZMW")).toHaveLength(2);
    expect(
      screen.getByText(/no card, mobile money, or bank details are collected/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View more" }));
    fireEvent.click(screen.getByRole("button", { name: "Airtel Money" }));
    expect(screen.getByRole("button", { name: "Airtel Money" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(mocks.selectPropertySubscriptionPlan).toHaveBeenCalledWith({}, "plan-1");
    });
    expect(await screen.findByText(/Plan selection saved/)).toBeInTheDocument();
  });
});
