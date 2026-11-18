import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deptForRole, type Role, type StaffDepartment } from "@/lib/types";
import { parseAuthIdentifier } from "@/lib/auth-identifier";
import { isMissingStaffMembersTable, recipientsFromProfiles } from "@/lib/staffRecipients";
import { invokeGpmMobileApi, usesGpmMobileApi } from "@/lib/gpmMobileApi";
import type { StaffRecipient } from "@/lib/staffRecipients";
import type { User } from "@/lib/types";
import { z } from "zod";

const roles = [
  "Admin",
  "Manager",
  "Supervisor",
  "Front Desk",
  "Housekeeping",
  "Maintenance",
  "Restaurant",
] as const;
const GILNET_AUTH_CALLBACK = "gilnet://auth/callback";
const staffDepartmentForRole: Record<Role, StaffDepartment> = {
  Admin: "Admin",
  Manager: "Admin",
  Supervisor: "Admin",
  "Front Desk": "Front Office",
  Housekeeping: "Housekeeping",
  Maintenance: "Maintenance",
  Restaurant: "Food and Beverage",
};
const escapeLikeValue = (value: string) => value.replace(/[\\%_]/g, "\\$&");

function generateStaffPin() {
  const range = 1_000_000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  let value = 0;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  } while (value >= limit);
  return String(value % range).padStart(6, "0");
}

function generateTemporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `Gpm!${random}a9`;
}

async function getSupabaseAdmin() {
  if (process.env["GILNET_DESKTOP_APP"] === "true" && !process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
    throw new Error(
      "The Supabase server key is not configured. Use File > Configure Supabase server key in the desktop app, then try again.",
    );
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const staffInput = z.object({
  action: z.enum(["list", "create", "update", "delete", "reset_pin", "send_password_reset"]),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  loginIdentifier: z.string().trim().min(1).optional(),
  password: z.string().min(8).optional(),
  pin: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  role: z.enum(roles).optional(),
});

const manageStaffServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => staffInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: caller, error } = await context.supabase
      .from("user_roles")
      .select("*")
      .eq("user_id", context.userId)
      .single();
    if (error || !["Admin", "Manager", "Supervisor"].includes(caller?.role ?? "")) {
      throw new Error("Only an administrator, manager or supervisor can manage staff.");
    }
    if (data.role === "Admin" && caller.role !== "Admin") {
      throw new Error("Only an administrator can assign the Admin role.");
    }
    if (data.action === "update" && data.password) {
      throw new Error("Management passwords must be reset with the email confirmation code.");
    }

    const supabaseAdmin = await getSupabaseAdmin();

    if (data.action === "create") {
      if (!data.name || !data.email || !data.role) {
        throw new Error("Name, email and permission role are required.");
      }
      const isManagement = ["Admin", "Manager", "Supervisor"].includes(data.role);
      const companyEmail = data.email.trim().toLowerCase();
      const authIdentifier = isManagement
        ? parseAuthIdentifier(data.loginIdentifier ?? "")
        : { email: companyEmail };
      const authEmail = "email" in authIdentifier ? authIdentifier.email : undefined;
      if (!authEmail) {
        throw new Error("Management accounts must use a login email address.");
      }
      if (
        !isManagement &&
        data.loginIdentifier &&
        data.loginIdentifier.trim().toLowerCase() !== companyEmail
      ) {
        throw new Error("Staff sign-in email must match the staff email.");
      }
      if (isManagement && !data.password) {
        throw new Error(
          "Management accounts must use an email address and a password of at least 8 characters.",
        );
      }
      const staffPin = data.pin ?? generateStaffPin();
      const { data: hashedPin, error: hashError } = await supabaseAdmin.rpc("gpm_hash_staff_pin", {
        p_pin: staffPin,
      });
      if (hashError || !hashedPin)
        throw new Error(hashError?.message ?? "Could not secure the staff PIN.");

      const initialPassword = isManagement ? data.password! : generateTemporaryPassword();
      const { data: created, error: creationError } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        password: initialPassword,
        email_confirm: !isManagement,
        user_metadata: {
          name: data.name,
          username: authEmail.split("@")[0],
          company_email: companyEmail,
          property_code: caller.property_code,
          department: deptForRole(data.role),
          ...(isManagement ? {} : { initial_password: initialPassword }),
        },
      });
      if (creationError || !created.user)
        throw new Error(creationError?.message ?? "Account creation failed.");

      const userId = created.user.id;
      const rollbackCreatedAccount = async () => {
        const membershipRollback = await supabaseAdmin
          .from("staff_members")
          .delete()
          .eq("auth_user_id", userId);
        const roleRollback = await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
        const accountRollback = await supabaseAdmin.auth.admin.deleteUser(userId);
        return [
          membershipRollback.error?.message,
          roleRollback.error?.message,
          accountRollback.error?.message,
        ].filter((message): message is string => !!message);
      };
      const profile = await supabaseAdmin
        .from("profiles")
        .update({ name: data.name, property_code: caller.property_code })
        .eq("id", userId);
      const role = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, property_code: caller.property_code, role: data.role });
      const membership = await supabaseAdmin.from("staff_members").insert({
        auth_user_id: userId,
        property_code: caller.property_code,
        company_email: companyEmail,
        staff_name: data.name,
        department: staffDepartmentForRole[data.role],
        role: data.role,
        pin_hash: hashedPin,
        pin_setup_required: !isManagement,
      });

      if (profile.error || role.error || membership.error) {
        const cleanupErrors = await rollbackCreatedAccount();
        const cleanupDetail = cleanupErrors.length
          ? ` Account cleanup also failed: ${cleanupErrors.join("; ")}`
          : "";
        if (role.error?.code === "23514" || membership.error?.code === "23514") {
          throw new Error(
            `The staff role database rules are out of date. Apply drizzle/migrations/0005_staff_role_constraints.sql to Supabase, then try again. ${role.error?.message ?? membership.error?.message}${cleanupDetail}`,
          );
        }
        const assignmentError =
          profile.error?.message ??
          role.error?.message ??
          membership.error?.message ??
          "Could not assign staff account.";
        throw new Error(`${assignmentError}${cleanupDetail}`);
      }
      if (isManagement) {
        const { error: confirmationError } = await supabaseAdmin.auth.resend({
          type: "signup",
          email: authEmail,
        });
        if (confirmationError) {
          const cleanupErrors = await rollbackCreatedAccount();
          throw new Error(
            `Could not send the management account confirmation code: ${confirmationError.message}${cleanupErrors.length ? ` Account cleanup failed: ${cleanupErrors.join("; ")}` : ""}`,
          );
        }
      } else {
        const { error: setupEmailError } =
          await supabaseAdmin.auth.resetPasswordForEmail(authEmail);
        if (setupEmailError) {
          const cleanupErrors = await rollbackCreatedAccount();
          throw new Error(
            `Could not send the staff login details: ${setupEmailError.message}${cleanupErrors.length ? ` Account cleanup failed: ${cleanupErrors.join("; ")}` : ""}`,
          );
        }
        const { error: metadataCleanupError } = await supabaseAdmin.auth.admin.updateUserById(
          userId,
          {
            user_metadata: { initial_password: null },
          },
        );
        if (metadataCleanupError) {
          const rollbackErrors = await rollbackCreatedAccount();
          throw new Error(
            `Could not remove the emailed password from account metadata. ${rollbackErrors.length ? `Account cleanup also failed: ${rollbackErrors.join("; ")}` : "The staff account was removed; retry creation."}`,
          );
        }
      }
    }

    if (data.action === "delete" || data.action === "update") {
      if (!data.id || data.id === context.userId) {
        throw new Error("You cannot change or delete your own administrator access here.");
      }
      const target = await context.supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", data.id)
        .single();
      if (target.data?.property_code !== caller.property_code)
        throw new Error("Staff account not found.");
      if (target.data.role === "Admin")
        throw new Error("Administrator accounts cannot be removed or demoted here.");
      if (data.action === "update" && data.role) {
        const wasManagement = ["Admin", "Manager", "Supervisor"].includes(target.data.role);
        const becomesManagement = ["Admin", "Manager", "Supervisor"].includes(data.role);
        if (wasManagement !== becomesManagement) {
          throw new Error(
            "This change requires different sign-in credentials. Create an account with the new role and matching sign-in method instead.",
          );
        }
      }

      const member = await supabaseAdmin
        .from("staff_members")
        .select("auth_user_id, pin_hash")
        .eq("auth_user_id", data.id)
        .eq("property_code", caller.property_code)
        .maybeSingle();

      if (data.action === "delete") {
        const result = await supabaseAdmin.auth.admin.deleteUser(data.id);
        if (result.error) throw result.error;
      } else {
        if (data.name) {
          const result = await supabaseAdmin
            .from("profiles")
            .update({ name: data.name })
            .eq("id", data.id);
          if (result.error) throw result.error;
          if (member.data) {
            const update = await supabaseAdmin
              .from("staff_members")
              .update({ staff_name: data.name })
              .eq("auth_user_id", data.id);
            if (update.error) throw update.error;
          }
        }
        if (data.role) {
          const result = await supabaseAdmin
            .from("user_roles")
            .update({ role: data.role })
            .eq("user_id", data.id);
          if (result.error) throw result.error;
          if (member.data) {
            const update = await supabaseAdmin
              .from("staff_members")
              .update({ role: data.role, department: staffDepartmentForRole[data.role] })
              .eq("auth_user_id", data.id);
            if (update.error) throw update.error;
            const { data: authUser, error: authLookupError } =
              await supabaseAdmin.auth.admin.getUserById(data.id);
            if (authLookupError || !authUser.user)
              throw authLookupError ?? new Error("Could not load staff account.");
            const metadataUpdate = await supabaseAdmin.auth.admin.updateUserById(data.id, {
              user_metadata: {
                ...(authUser.user.user_metadata ?? {}),
                department: deptForRole(data.role),
              },
            });
            if (metadataUpdate.error) throw metadataUpdate.error;
          }
        }
        if (member.data && data.email) {
          const companyEmail = data.email?.trim().toLowerCase();
          if (companyEmail) {
            const existingStaff = await supabaseAdmin
              .from("staff_members")
              .select("auth_user_id", { count: "exact", head: true })
              .eq("property_code", caller.property_code)
              .neq("auth_user_id", data.id)
              .ilike("company_email", escapeLikeValue(companyEmail));
            if (existingStaff.error) throw existingStaff.error;
            if ((existingStaff.count ?? 0) >= 7) {
              throw new Error(
                "This company email already has the maximum of 7 staff for this property.",
              );
            }
          }
          const update = await supabaseAdmin
            .from("staff_members")
            .update({
              ...(companyEmail ? { company_email: companyEmail } : {}),
              ...(data.name ? { staff_name: data.name } : {}),
            })
            .eq("auth_user_id", data.id);
          if (update.error) throw update.error;
          if (data.email) {
            const { data: authUser, error: authLookupError } =
              await supabaseAdmin.auth.admin.getUserById(data.id);
            if (authLookupError || !authUser.user)
              throw authLookupError ?? new Error("Could not load staff account.");
            const userMetadata = authUser.user.user_metadata ?? {};
            const metadataUpdate = await supabaseAdmin.auth.admin.updateUserById(data.id, {
              user_metadata: {
                ...userMetadata,
                ...(companyEmail
                  ? { company_email: companyEmail, username: companyEmail.split("@")[0] }
                  : {}),
              },
            });
            if (metadataUpdate.error) throw metadataUpdate.error;
          }
        }
      }
    }

    if (data.action === "reset_pin" || data.action === "send_password_reset") {
      if (!data.id || data.id === context.userId) {
        throw new Error("Choose another property account to reset.");
      }
      const target = await context.supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", data.id)
        .eq("property_code", caller.property_code)
        .single();
      if (target.error || !target.data) throw new Error("Property account not found.");

      const isManagement = ["Admin", "Manager", "Supervisor"].includes(target.data.role);
      if (data.action === "reset_pin") {
        if (isManagement) {
          throw new Error("A PIN reset link can only be sent for a staff account.");
        }
        const member = await supabaseAdmin
          .from("staff_members")
          .select("auth_user_id, pin_setup_required")
          .eq("auth_user_id", data.id)
          .eq("property_code", caller.property_code)
          .eq("active", true)
          .maybeSingle();
        if (member.error) throw member.error;
        if (!member.data) throw new Error("Staff account not found.");
        const setupRequired = await supabaseAdmin
          .from("staff_members")
          .update({ pin_setup_required: true })
          .eq("auth_user_id", data.id)
          .eq("property_code", caller.property_code);
        if (setupRequired.error) throw setupRequired.error;
        const { data: authUser, error: authLookupError } =
          await supabaseAdmin.auth.admin.getUserById(data.id);
        if (authLookupError || !authUser.user?.email) {
          const rollback = await supabaseAdmin
            .from("staff_members")
            .update({ pin_setup_required: member.data.pin_setup_required })
            .eq("auth_user_id", data.id)
            .eq("property_code", caller.property_code);
          if (rollback.error)
            throw new Error(
              `Could not find the staff login email: ${authLookupError?.message ?? "email is missing"}. The PIN setup state could not be restored: ${rollback.error.message}`,
            );
          throw authLookupError ?? new Error("The staff account has no login email.");
        }
        const reset = await supabaseAdmin.auth.resetPasswordForEmail(authUser.user.email, {
          redirectTo: GILNET_AUTH_CALLBACK,
        });
        if (reset.error) {
          const rollback = await supabaseAdmin
            .from("staff_members")
            .update({ pin_setup_required: member.data.pin_setup_required })
            .eq("auth_user_id", data.id)
            .eq("property_code", caller.property_code);
          if (rollback.error) {
            throw new Error(
              `Could not send the PIN reset link: ${reset.error.message}. The PIN setup state could not be restored: ${rollback.error.message}`,
            );
          }
          throw new Error(`Could not send the PIN reset link: ${reset.error.message}`);
        }
      } else {
        const { data: authUser, error: authLookupError } =
          await supabaseAdmin.auth.admin.getUserById(data.id);
        if (authLookupError || !authUser.user?.email) {
          throw (
            authLookupError ?? new Error("The account does not have a resettable email address.")
          );
        }
        if (isManagement) {
          if (caller.role !== "Admin") {
            throw new Error("Only an administrator can initiate a management password reset.");
          }
          if (authUser.user.email.endsWith("@users.gilnet.app")) {
            throw new Error(
              "This older management account has no login email. Create a replacement management account with a unique email address.",
            );
          }
          if (!authUser.user.email_confirmed_at) {
            throw new Error(
              "The management user must confirm their email before a password reset can be sent.",
            );
          }
        } else {
          const member = await supabaseAdmin
            .from("staff_members")
            .select("auth_user_id")
            .eq("auth_user_id", data.id)
            .eq("property_code", caller.property_code)
            .eq("active", true)
            .maybeSingle();
          if (member.error) throw member.error;
          if (!member.data) throw new Error("Staff account not found.");
        }
        const reset = await supabaseAdmin.auth.resetPasswordForEmail(authUser.user.email, {
          redirectTo: GILNET_AUTH_CALLBACK,
        });
        if (reset.error) throw reset.error;
      }
    }

    const [profiles, rolesResult, members] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("property_code", caller.property_code),
      context.supabase.from("user_roles").select("*").eq("property_code", caller.property_code),
      supabaseAdmin
        .from("staff_members")
        .select("*")
        .eq("property_code", caller.property_code)
        .eq("active", true),
    ]);
    if (profiles.error || rolesResult.error || members.error)
      throw new Error("Could not load staff.");

    return Promise.all(
      (profiles.data ?? []).map(async (profile) => {
        const role =
          roles.find(
            (candidate) =>
              candidate === rolesResult.data?.find((row) => row.user_id === profile.id)?.role,
          ) ?? "Front Desk";
        const member = members.data?.find((row) => row.auth_user_id === profile.id);
        const { data: auth } = await supabaseAdmin.auth.admin.getUserById(profile.id);
        return {
          id: profile.id,
          name: member?.staff_name ?? profile.name,
          username: profile.username,
          email: member?.company_email ?? auth.user?.email ?? "",
          loginIdentifier: auth.user?.phone ?? auth.user?.email ?? "",
          password: "",
          role,
          department: member?.department ?? "",
          isStaffMember: !!member,
        };
      }),
    );
  });

const ownStaffPinInput = z.object({
  currentPin: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  newPin: z.string().regex(/^\d{6}$/),
});

const changeOwnStaffPinServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => ownStaffPinInput.parse(input))
  .handler(async ({ data, context }) => {
    const roleResult = await context.supabase
      .from("user_roles")
      .select("property_code, role")
      .eq("user_id", context.userId)
      .single();
    if (roleResult.error) throw roleResult.error;
    if (["Admin", "Manager", "Supervisor"].includes(roleResult.data.role)) {
      throw new Error("Management accounts use Change Password, not a staff PIN.");
    }

    const supabaseAdmin = await getSupabaseAdmin();
    const member = await supabaseAdmin
      .from("staff_members")
      .select("pin_hash, pin_setup_required")
      .eq("auth_user_id", context.userId)
      .eq("property_code", roleResult.data.property_code)
      .eq("active", true)
      .maybeSingle();
    if (member.error) throw member.error;
    if (!member.data) throw new Error("Active staff account not found.");
    if (!member.data.pin_setup_required) {
      if (!data.currentPin) throw new Error("Enter your current PIN before changing it.");
      if (data.currentPin === data.newPin) {
        throw new Error("Choose a different PIN from your current PIN.");
      }
      const verified = await supabaseAdmin.rpc("gpm_verify_staff_pin", {
        p_user_id: context.userId,
        p_pin: data.currentPin,
      });
      if (verified.error) throw verified.error;
      if (!verified.data) throw new Error("The current PIN is incorrect or temporarily locked.");
    }

    const { data: pinHash, error: hashError } = await supabaseAdmin.rpc("gpm_hash_staff_pin", {
      p_pin: data.newPin,
    });
    if (hashError || !pinHash) {
      throw new Error(hashError?.message ?? "Could not secure the new PIN.");
    }
    const pinUpdate = await supabaseAdmin
      .from("staff_members")
      .update({ pin_hash: pinHash, pin_setup_required: false })
      .eq("auth_user_id", context.userId)
      .eq("property_code", roleResult.data.property_code)
      .eq("active", true)
      .select("auth_user_id")
      .maybeSingle();
    if (pinUpdate.error) throw pinUpdate.error;
    if (!pinUpdate.data) throw new Error("Active staff account not found.");
  });

type ManageStaffInput = z.infer<typeof staffInput>;
type OwnStaffPinInput = z.infer<typeof ownStaffPinInput>;

export async function manageStaff({ data }: { data: ManageStaffInput }): Promise<User[]> {
  if (usesGpmMobileApi() || typeof window !== "undefined") {
    return invokeGpmMobileApi<User[]>({ action: "manage_staff", data });
  }
  return manageStaffServer({ data });
}

export async function changeOwnStaffPin({ data }: { data: OwnStaffPinInput }): Promise<void> {
  if (usesGpmMobileApi()) {
    return invokeGpmMobileApi<void>({ action: "change_own_staff_pin", data });
  }
  return changeOwnStaffPinServer({ data });
}

const listStaffRecipientsServer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await context.supabase
      .from("user_roles")
      .select("property_code")
      .eq("user_id", context.userId)
      .single();
    if (role.error) throw role.error;
    const { data, error } = await context.supabase
      .from("staff_members")
      .select("auth_user_id, staff_name, department")
      .eq("property_code", role.data.property_code)
      .eq("active", true)
      .neq("auth_user_id", context.userId)
      .order("staff_name");
    if (!error) {
      return (data ?? []).map((member) => ({
        id: member.auth_user_id,
        name: member.staff_name,
        department: member.department,
      }));
    }
    if (!isMissingStaffMembersTable(error)) throw error;

    const [profiles, propertyRoles] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("id, name")
        .eq("property_code", role.data.property_code),
      context.supabase
        .from("user_roles")
        .select("user_id")
        .eq("property_code", role.data.property_code),
    ]);
    if (profiles.error) throw profiles.error;
    if (propertyRoles.error) throw propertyRoles.error;
    return recipientsFromProfiles(profiles.data ?? [], propertyRoles.data ?? [], context.userId);
  });

export async function listStaffRecipients(): Promise<StaffRecipient[]> {
  if (usesGpmMobileApi()) {
    return invokeGpmMobileApi<StaffRecipient[]>({ action: "list_staff_recipients" });
  }
  return listStaffRecipientsServer();
}
