import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/gpm/AppShell";
import { AttendancePanel } from "@/components/gpm/AttendancePanel";
import { AttendanceShiftSettings } from "@/components/gpm/AttendanceShiftSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/auth";
import { isValidEmail } from "@/lib/auth-identifier";
import { manageStaff } from "@/lib/staff.functions";
import { ROLES, type Role, type User } from "@/lib/types";

export const Route = createFileRoute("/staff")({
  component: StaffPage,
});

export function StaffPage() {
  const session = useSession();
  const propertyCode = session?.property_code ?? "";
  const [staff, setStaff] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("Maintenance");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const isManagementRole = role === "Admin" || role === "Manager" || role === "Supervisor";
  const validCompanyEmail = isValidEmail(email);
  const validLoginEmail = isValidEmail(loginIdentifier);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const users = await manageStaff({ data: { action: "list" } });
      setStaff(users as User[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load staff.");
    }
  }, []);

  useEffect(() => {
    if (propertyCode) void refresh();
  }, [propertyCode, refresh]);

  const addStaff = async () => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await manageStaff({
        data: {
          action: "create",
          name,
          email,
          ...(isManagementRole ? { loginIdentifier } : {}),
          ...(isManagementRole ? { password } : {}),
          role,
        },
      });
      setStatus(
        isManagementRole
          ? `Management account created. A six-digit confirmation email was requested for ${loginIdentifier}.`
          : `Staff account created. An email with the property code and generated login password was requested for ${email}. They can change it under Account > Edit Profile > Change Password. Check Spam/Junk if it does not arrive.`,
      );
      setName("");
      setEmail("");
      setLoginIdentifier("");
      setPassword("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the staff account.");
    } finally {
      setBusy(false);
    }
  };

  const updateRole = async (member: User, nextRole: Role) => {
    setError("");
    try {
      await manageStaff({ data: { action: "update", id: member.id, role: nextRole } });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the staff role.");
    }
  };

  const deleteStaff = async (member: User) => {
    if (!window.confirm(`Delete ${member.name}'s staff account?`)) return;
    setError("");
    try {
      await manageStaff({ data: { action: "delete", id: member.id } });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the staff account.");
    }
  };

  const sendPasswordReset = async (member: User) => {
    setError("");
    setStatus("");
    try {
      await manageStaff({ data: { action: "send_password_reset", id: member.id } });
      setStatus(`A password reset email was requested for ${member.loginIdentifier}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the password reset code.");
    }
  };

  return (
    <AppShell title="Staff Management" allow="users">
      <div className="mx-auto max-w-3xl space-y-5">
        <section className="space-y-3 rounded-2xl border border-brand-border bg-card p-4">
          <div>
            <h2 className="font-bold">Add staff member</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Staff use one email for sign-in and receive the property code and a generated login
              password there. They may keep it or change it in Account &gt; Edit Profile. Management
              accounts use email and password.
            </p>
          </div>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void addStaff();
            }}
          >
            <Input
              aria-label="Staff full name"
              placeholder="Staff full name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <Input
              aria-label={isManagementRole ? "Company email" : "Staff email"}
              type="email"
              placeholder={isManagementRole ? "Company email" : "Staff email"}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={!!email.trim() && !validCompanyEmail}
              required
            />
            {!!email.trim() && !validCompanyEmail && (
              <p className="text-sm text-destructive">Enter a valid company email address.</p>
            )}
            {isManagementRole && (
              <>
                <Input
                  aria-label="Management login email"
                  type="email"
                  placeholder="Management login email"
                  value={loginIdentifier}
                  onChange={(event) => setLoginIdentifier(event.target.value)}
                  aria-invalid={!!loginIdentifier.trim() && !validLoginEmail}
                  required
                />
                {!!loginIdentifier.trim() && !validLoginEmail && (
                  <p className="text-sm text-destructive">Enter a valid login email address.</p>
                )}
              </>
            )}
            {isManagementRole && (
              <Input
                aria-label="Initial password"
                type="password"
                autoComplete="new-password"
                placeholder="Initial password (at least 8 characters)"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
              />
            )}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Permission role</p>
              <Select value={role} onValueChange={(value) => setRole(value as Role)}>
                <SelectTrigger aria-label="Permission role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              disabled={
                busy ||
                !name.trim() ||
                !validCompanyEmail ||
                (isManagementRole && !validLoginEmail) ||
                (isManagementRole && password.length < 8)
              }
            >
              {busy ? "Creating…" : "Add staff"}
            </Button>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {status && (
              <p role="status" className="text-sm text-primary">
                {status}
              </p>
            )}
          </form>
        </section>

        <section className="space-y-3 rounded-2xl border border-brand-border bg-card p-4">
          <h2 className="font-bold">Property staff</h2>
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No staff members found.</p>
          ) : (
            <ul className="divide-y">
              {staff.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{member.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.loginIdentifier}
                    </p>
                    <p className="text-xs text-muted-foreground">{member.role}</p>
                  </div>
                  {!["Admin", "Manager", "Supervisor"].includes(member.role) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void sendPasswordReset(member)}
                    >
                      Send password reset link
                    </Button>
                  )}
                  {session?.role === "Admin" &&
                    ["Admin", "Manager", "Supervisor"].includes(member.role) &&
                    member.id !== session.token &&
                    (member.loginIdentifier?.includes("@") ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void sendPasswordReset(member)}
                      >
                        Send password reset email
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Needs a management email
                      </span>
                    ))}
                  {member.role !== "Admin" && (
                    <>
                      <Select
                        value={member.role}
                        onValueChange={(value) => void updateRole(member, value as Role)}
                      >
                        <SelectTrigger aria-label={`Role for ${member.name}`} className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((item) => (
                            <SelectItem key={item} value={item}>
                              {item}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => void deleteStaff(member)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-3 rounded-2xl border border-brand-border bg-card p-4">
          <div>
            <h2 className="font-bold">Staff attendance log</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Registered property staff are listed each day, including staff who have not checked
              in.
            </p>
          </div>
          <AttendancePanel />
        </section>
        {(session?.role === "Admin" || session?.role === "Manager") && <AttendanceShiftSettings />}
      </div>
    </AppShell>
  );
}
