import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  CreditCard,
  LockKeyhole,
  RefreshCw,
  Smartphone,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/gpm/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { can, useSession } from "@/lib/auth";
import {
  fetchPropertySubscription,
  selectPropertySubscriptionPlan,
  type PropertySubscriptionData,
} from "@/lib/subscriptions";

export const Route = createFileRoute("/payment")({
  component: PaymentPage,
});

export function PaymentPage() {
  const session = useSession();
  const [data, setData] = useState<PropertySubscriptionData | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [checkoutStep, setCheckoutStep] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("Card");
  const [showMoreMethods, setShowMoreMethods] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const loadRequest = useRef(0);

  const loadPlans = useCallback(async () => {
    const requestId = ++loadRequest.current;
    if (!can(session?.role, "billing")) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await fetchPropertySubscription(supabase);
      if (requestId !== loadRequest.current) return;
      setData(result);
      setSelectedPlanId(result.subscription?.plan_id ?? "");
    } catch (cause: unknown) {
      if (requestId === loadRequest.current) {
        setError(cause instanceof Error ? cause.message : "Could not load plans.");
      }
    } finally {
      if (requestId === loadRequest.current) setLoading(false);
    }
  }, [session?.property_code, session?.role]);

  useEffect(() => {
    void loadPlans();
    return () => {
      loadRequest.current += 1;
    };
  }, [loadPlans]);

  const savePlan = async () => {
    if (session?.role !== "Admin" || !selectedPlanId) return;
    setSaving(true);
    setError("");
    setStatusMessage("");
    try {
      await selectPropertySubscriptionPlan(supabase, selectedPlanId);
      const updated = await fetchPropertySubscription(supabase);
      setData(updated);
      setSelectedPlanId(updated.subscription?.plan_id ?? selectedPlanId);
      setStatusMessage(
        "Plan selection saved. Payment setup is not connected, and no payment has been taken.",
      );
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not save this property plan.");
    } finally {
      setSaving(false);
    }
  };

  const selectedPlan = data?.plans.find((plan) => plan.id === selectedPlanId);

  return (
    <AppShell title="Property Subscription" allow="billing">
      <div className={`mx-auto ${checkoutStep && selectedPlan ? "max-w-6xl" : "max-w-2xl"}`}>
        <section className="overflow-hidden rounded-3xl border border-brand-border bg-card shadow-sm">
          {checkoutStep && selectedPlan ? (
            <div className="grid min-h-[min(680px,calc(100vh-12rem))] md:grid-cols-[minmax(260px,0.82fr)_minmax(0,1.55fr)]">
              <aside className="flex flex-col bg-brand-soft p-5 sm:p-8">
                <button
                  type="button"
                  className="mb-7 flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setCheckoutStep(false)}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Back to plans
                </button>
                <p className="text-sm text-muted-foreground">Subscription</p>
                <h2 className="mt-1 text-xl font-bold">{selectedPlan.name}</h2>
                {selectedPlan.description && (
                  <p className="mt-2 text-sm text-muted-foreground">{selectedPlan.description}</p>
                )}
                <div className="mt-8 space-y-3 border-b border-dashed border-brand-border pb-5 text-sm">
                  <div className="flex justify-between gap-4 text-muted-foreground">
                    <span>Price · billed {getBillingPeriod(selectedPlan.billing_interval)}</span>
                    <span className="shrink-0">
                      K{selectedPlan.price.toLocaleString()} {selectedPlan.currency}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 text-base font-semibold">
                    <span>Total</span>
                    <span>
                      K{selectedPlan.price.toLocaleString()} {selectedPlan.currency}
                    </span>
                  </div>
                </div>
                {(selectedPlan.features.length
                  ? selectedPlan.features
                  : [`Access to the ${selectedPlan.name} plan`]
                ).map((feature) => (
                  <div key={feature} className="mt-4 flex items-start gap-3 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{feature}</span>
                  </div>
                ))}
                {data?.property && (
                  <div className="mt-auto border-t border-brand-border pt-5 text-sm">
                    <p className="font-semibold">{data.property.name}</p>
                    {data.property.billingEmail && (
                      <p className="mt-1 text-muted-foreground">{data.property.billingEmail}</p>
                    )}
                  </div>
                )}
              </aside>

              <div className="p-5 sm:p-8">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight">Payment method</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Choose how you would like to pay for this plan.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Back to plans"
                    onClick={() => setCheckoutStep(false)}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                {error && (
                  <p
                    role="alert"
                    className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}
                {statusMessage && (
                  <p
                    role="status"
                    className="mb-4 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success"
                  >
                    {statusMessage}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <PaymentMethodButton
                    active={paymentMethod === "Card"}
                    icon={<CreditCard className="h-4 w-4 text-amber-500" aria-hidden="true" />}
                    label="Card"
                    onClick={() => setPaymentMethod("Card")}
                  />
                  <PaymentMethodButton
                    active={paymentMethod === "Mobile Money"}
                    icon={<Smartphone className="h-4 w-4 text-sky-600" aria-hidden="true" />}
                    label="Mobile Money"
                    onClick={() => setPaymentMethod("Mobile Money")}
                  />
                  <PaymentMethodButton
                    active={paymentMethod === "Bank Transfer"}
                    icon={<WalletCards className="h-4 w-4 text-primary" aria-hidden="true" />}
                    label="Bank Transfer"
                    onClick={() => setPaymentMethod("Bank Transfer")}
                  />
                  <button
                    type="button"
                    aria-expanded={showMoreMethods}
                    onClick={() => setShowMoreMethods((shown) => !shown)}
                    className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-muted px-3 text-sm font-semibold transition-colors hover:bg-accent"
                  >
                    View more
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${showMoreMethods ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                </div>

                {showMoreMethods && (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {["Airtel Money", "MTN Mobile Money", "Zamtel Kwacha"].map((method) => (
                      <PaymentMethodButton
                        key={method}
                        active={paymentMethod === method}
                        icon={<Smartphone className="h-4 w-4 text-primary" aria-hidden="true" />}
                        label={method}
                        onClick={() => setPaymentMethod(method)}
                      />
                    ))}
                  </div>
                )}

                <div className="mt-6 rounded-xl border border-brand-border bg-background p-4 sm:p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <LockKeyhole className="h-4 w-4 text-primary" aria-hidden="true" />
                    {paymentMethod} details
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Secure payment setup will be available here once a payment provider is
                    connected. No card, mobile money, or bank details are collected in this preview.
                  </p>
                </div>

                <p className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-5">
                  Online checkout is not connected yet. Continuing records your plan selection only;
                  no payment is processed.
                </p>
                <Button
                  type="button"
                  className="mt-6 h-12 w-full rounded-xl bg-gradient-to-r from-sky-400 via-blue-600 to-violet-600 text-base font-semibold text-white hover:opacity-90"
                  disabled={!selectedPlanId || saving}
                  onClick={() => void savePlan()}
                >
                  {saving ? "Saving…" : "Continue"}
                </Button>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  By continuing, you confirm the subscription plan selected for this property.
                  Payment terms will be shown when online checkout becomes available.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-brand-soft px-5 pb-5 pt-6 sm:px-8">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                    <CreditCard className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-xl font-extrabold">Property subscription</h2>
                    <p className="text-sm text-muted-foreground">
                      Plans and billing belong to the property account.
                    </p>
                  </div>
                </div>
                {data && (
                  <p className="mt-4 text-sm">
                    <span className="font-semibold">{data.property.name}</span>
                    {session?.role === "Admin" && data.property.billingEmail && (
                      <span className="text-muted-foreground"> · {data.property.billingEmail}</span>
                    )}
                  </p>
                )}
              </div>

              <div className="space-y-5 p-5 sm:p-8">
                {error && (
                  <p
                    role="alert"
                    className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}
                {statusMessage && (
                  <p
                    role="status"
                    className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success"
                  >
                    {statusMessage}
                  </p>
                )}

                {loading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Loading property subscription…
                  </p>
                ) : session?.role !== "Admin" ? (
                  <div className="space-y-4 rounded-2xl border border-brand-border bg-background p-5">
                    <h3 className="font-semibold">Subscription status</h3>
                    <p className="text-sm text-muted-foreground">
                      {data?.subscription
                        ? `Current status: ${data.subscription.status === "pending_payment" ? "Awaiting payment setup" : data.subscription.status}`
                        : "No subscription plan has been selected for this property yet."}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Your property Admin manages plan selection and billing. Staff accounts are not
                      charged separately.
                    </p>
                    <Button type="button" variant="outline" onClick={() => void loadPlans()}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh status
                    </Button>
                  </div>
                ) : data?.plans.length ? (
                  <>
                    <div className="space-y-3">
                      {data.plans.map((plan) => (
                        <button
                          type="button"
                          key={plan.id}
                          aria-pressed={selectedPlanId === plan.id}
                          onClick={() => setSelectedPlanId(plan.id)}
                          className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                            selectedPlanId === plan.id
                              ? "border-primary bg-primary/5"
                              : "border-brand-border bg-background hover:bg-muted/50"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-bold">{plan.name}</span>
                                {plan.recommended && (
                                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                                    Recommended
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {plan.description}
                              </p>
                            </div>
                            <span className="shrink-0 text-right font-semibold">
                              K{plan.price.toLocaleString()}
                              <span className="block text-xs font-normal text-muted-foreground">
                                / {plan.billing_interval}
                              </span>
                            </span>
                          </div>
                          {plan.features.length > 0 && (
                            <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                              {plan.features.map((feature) => (
                                <li
                                  key={feature}
                                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                                >
                                  <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                                  {feature}
                                </li>
                              ))}
                            </ul>
                          )}
                        </button>
                      ))}
                    </div>

                    {data.subscription && (
                      <p className="text-sm text-muted-foreground">
                        Current status:{" "}
                        <span className="font-medium text-foreground">
                          {data.subscription.status === "pending_payment"
                            ? "Awaiting payment setup"
                            : data.subscription.status}
                        </span>
                      </p>
                    )}

                    <Button
                      type="button"
                      className="h-11 w-full rounded-xl"
                      disabled={!selectedPlanId || saving}
                      onClick={() => {
                        setError("");
                        setStatusMessage("");
                        setCheckoutStep(true);
                      }}
                    >
                      Continue
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      Online checkout is not configured. Saving a plan records the property’s
                      selection only; no property, user, or staff account is charged.
                    </p>
                  </>
                ) : (
                  <div className="py-8 text-center">
                    <p className="font-semibold">No subscription plans are available yet.</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Contact GILNET support or check again after plans are published in the Admin
                      Hub.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-4"
                      onClick={() => void loadPlans()}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh plans
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function PaymentMethodButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-14 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors ${
        active
          ? "border-indigo-500 bg-white text-slate-900 ring-1 ring-indigo-500"
          : "border-transparent bg-muted text-foreground hover:bg-accent"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function getBillingPeriod(interval: "monthly" | "quarterly" | "yearly"): string {
  if (interval === "yearly") return "every year";
  if (interval === "quarterly") return "every 3 months";
  return "every month";
}
