import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Crown, ImagePlus, KeyRound, LogOut, Mail, MapPin, Phone, RefreshCw, Settings, Building2, UserPen, Users } from "lucide-react";
import { AppShell } from "@/components/gpm/AppShell";
import { SupabaseBackupPanel } from "@/components/gpm/SupabaseBackupPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { can, clearRemembered, enc, getRemembered, logout, useSession } from "@/lib/auth";
import { keys, useStored, write } from "@/lib/db";
import { APP_NAME, APP_VERSION, SUPPORT_EMAIL, compareVersions, fetchLatestVersion, type VersionInfo } from "@/lib/version";
import { manageStaff } from "@/lib/staff.functions";
import { isValidEmail } from "@/lib/auth-identifier";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { stopSync } from "@/lib/supabaseSync";
import { applyWebUpdate } from "@/lib/app-update";
import { toast } from "sonner";
import { ROLES, type Property, type Role, type User } from "@/lib/types";
import { UserAgreementReviewButton } from "@/components/gpm/UserAgreement";
import { AppPreferencesPanel } from "@/components/gpm/AppPreferencesPanel";
import { PasskeySettings } from "@/components/gpm/PasskeySettings";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: `Account - ${APP_NAME}` },
      { name: "description", content: "Manage your profile, login, users and app updates." },
      { property: "og:title", content: `Account - ${APP_NAME}` },
      { property: "og:description", content: "Profile, login security, users and app updates." },
    ],
  }),
  component: AccountRoutePage,
});

function Row({ icon: Icon, label, onClick, danger }: { icon: typeof Settings; label: string; onClick?: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-2xl border border-brand-border p-3 text-left ${danger ? "bg-status-cancelled text-destructive" : "bg-card"}`}>
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${danger ? "bg-card" : "bg-brand-mint text-accent-foreground"}`}><Icon className="h-4 w-4" /></span>
      <span className="flex-1 text-sm font-semibold">{label}</span>
      <ChevronRight className="h-4 w-4 opacity-50" />
    </button>
  );
}

function AccountRoutePage() {
  return <AccountPage title="Account" />;
}

export function AccountPage({ title = "Account" }: { title?: string }) {
  const session = useSession();
  const queryClient=useQueryClient();
  const [profileOpen,setProfileOpen]=useState(false);
  const [passwordOpen,setPasswordOpen]=useState(false);
  const [profileName,setProfileName]=useState('');
  const [currentPassword,setCurrentPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [propertyName,setPropertyName]=useState('');
  const [propertyAddress,setPropertyAddress]=useState('');
  const [propertyPhone,setPropertyPhone]=useState('');
  const [propertyFile,setPropertyFile]=useState<File|null>(null);
  const [propertyPreview,setPropertyPreview]=useState<string|null>(null);
  const [propertyBusy,setPropertyBusy]=useState(false);
  const propertyFileRef=useRef<HTMLInputElement|null>(null);
  const navigate = useNavigate();
  const code = session?.property_code ?? "";
  const property = useStored<Property | null>(keys.property(code), null);
  const propertyPicture = property?.profile_image_url || property?.image_url || null;
  const propertyInitials = (property?.name || code || "Property")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const [confirmOut, setConfirmOut] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [latest, setLatest] = useState<VersionInfo | null>(null);
  const [checked, setChecked] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [remembered, setRemembered] = useState(() => (typeof window !== "undefined" ? !!getRemembered() : false));
  const newer = latest && compareVersions(latest.latestStable, APP_VERSION) > 0;
  const isDesktopApp = typeof window !== "undefined" && !!window.gilnetElectron;
  const isAndroidApp = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
  const updateButtonLabel = isDesktopApp
    ? "Install Update"
    : isAndroidApp
      ? latest?.apkUrl ? "Download APK" : "Android update unavailable"
      : latest?.publicUrl
        ? "Download Installer"
        : "Update Now";

  useEffect(()=>{
    setPropertyName(property?.name??'');
    setPropertyAddress(property?.address??'');
    setPropertyPhone(property?.phone??'');
  },[property?.name,property?.address,property?.phone]);

  useEffect(()=>{
    if(!propertyFile){setPropertyPreview(null);return;}
    const url=URL.createObjectURL(propertyFile);
    setPropertyPreview(url);
    return ()=>URL.revokeObjectURL(url);
  },[propertyFile]);

  const savePropertyProfile=async()=>{
    if(!session||session.role!=='Admin')return;
    if(!propertyName.trim()){toast.error('Property name is required.');return;}
    setPropertyBusy(true);
    let saveStage:'upload'|'property'='property';
    try{
      let imageUrl=propertyPicture;
      if(propertyFile){
        saveStage='upload';
        const extensions: Record<string,string> = {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
        };
        const ext=extensions[propertyFile.type];
        if(!ext)throw new Error('Choose a PNG, JPG, or WebP image.');
        if(propertyFile.size>5*1024*1024)throw new Error('Property image must be 5 MB or smaller.');
        const path = `${code}/profile/avatar-${crypto.randomUUID()}.${ext}`;
        const storage = supabase.storage.from("property_assets");
        const upload = await storage.upload(path, propertyFile, {
          contentType: propertyFile.type,
          cacheControl: "3600",
        });
        if(upload.error)throw upload.error;
        imageUrl=storage.getPublicUrl(path).data.publicUrl;
      }
      saveStage='property';
      const result=await supabase.from('properties').update({
        name:propertyName.trim(),
        address:propertyAddress.trim(),
        phone:propertyPhone.trim(),
        image_url:imageUrl,
      }).eq('code',code).select().single();
      if(result.error)throw result.error;
      write(keys.property(code),result.data,false);
      setPropertyFile(null);
      if(propertyFileRef.current)propertyFileRef.current.value='';
      toast.success('Property profile updated.');
    }catch(error){
      const message=error instanceof Error?error.message:'Could not update the property profile.';
      if(saveStage==='upload'&&/bucket not found|nosuchbucket/i.test(message)){
        toast.error('Profile image storage is not set up on this Supabase backend. Apply the property_assets storage migration, then try again.');
      }else if(/row.level security|permission denied|not authorized|unauthorized|403/i.test(message)){
        toast.error(saveStage==='upload'
          ? `Supabase blocked the image upload. In the Supabase dashboard, allow this property's Admin to upload within its own property_assets folder. ${message}`
          : `Supabase blocked the property update. In the Supabase dashboard, grant profile-field updates only to this property's Admin and add the matching RLS policy. The image may already be uploaded, but profile changes were not saved. ${message}`);
      }else toast.error(message);
    }finally{setPropertyBusy(false);}
  };

  const doLogout = async () => { stopSync();await queryClient.cancelQueries();queryClient.clear();await logout();navigate({to:"/login",replace:true}); };
  const check = async () => {
    setUpdateBusy(true); setUpdateError('');
    setLatest(null); setChecked(false);
    try {
      const desktop = window.gilnetElectron;
      if (desktop) {
        const result = await desktop.checkForUpdates();
        setLatest({
          latestStable: result.version,
          releaseNotes: result.releaseNotes,
          forced: false,
        });
        setChecked(true);
        return;
      }
      const result = await fetchLatestVersion();
      setLatest(result); setChecked(!!result);
      if (!result) setUpdateError('Could not check for updates. Connect to the internet and try again.');
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : 'Could not check for updates.');
    } finally { setUpdateBusy(false); }
  };
  const doUpdate = async () => {
    setUpdateBusy(true); setUpdateError('');
    try {
      const desktop = window.gilnetElectron;
      if (desktop) await desktop.update();
      else if (/android/i.test(navigator.userAgent)) {
        if (!latest?.apkUrl) throw new Error("No Android installer is available for this release.");
        const url = new URL(latest.apkUrl);
        if (url.protocol !== 'https:') throw new Error('A secure Android download is not available yet.');
        window.open(url.href, '_blank', 'noopener,noreferrer');
      } else if (latest?.publicUrl) {
        const url = new URL(latest.publicUrl);
        if (url.protocol !== 'https:') throw new Error('A secure installer download is not available yet.');
        window.open(url.href, '_blank', 'noopener,noreferrer');
      } else await applyWebUpdate();
      setUpdateOpen(false);
    } catch (error) { setUpdateError(error instanceof Error ? error.message : 'Update failed. Your saved data is unchanged.'); }
    finally { setUpdateBusy(false); }
  };

  return (
    <AppShell title={title}>
      <p className="-mt-2 mb-4 text-sm text-muted-foreground">
        {title === "Settings"
          ? "Choose your appearance and notification preferences."
          : "Manage profile"}
      </p>
      <div className="mx-auto max-w-2xl space-y-5">
        {title === "Settings" && <AppPreferencesPanel />}
        <section className="relative overflow-hidden rounded-3xl border border-brand-border bg-brand-soft p-5">


          <div className="relative flex items-center gap-4">
            <div className="relative">
              {propertyPicture ? (
                <img src={propertyPicture} alt={`${property?.name ?? code} profile`} width={70} height={70} className="h-[70px] w-[70px] rounded-full border-2 border-card bg-card object-cover" />
              ) : (
                <span className="grid h-[70px] w-[70px] place-items-center rounded-full border-2 border-card bg-brand-active text-lg font-bold text-accent-foreground">{propertyInitials}</span>
              )}
              <span className="absolute -right-1 bottom-0 rounded-full bg-brand-amber px-1 text-[10px] text-primary-foreground">★</span>
            </div>
            <div className="min-w-0">
              <p className="text-lg font-extrabold">{property?.name ?? code}</p>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-active px-2 py-0.5 text-[11px] font-semibold text-accent-foreground"><Crown className="h-3 w-3" /> {session?.role} member</span>
              {property?.phone && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" /> {property.phone}</p>}
              <p className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> {property?.address}</p>
            </div>
          </div>
        </section>

        {session?.role==='Admin'&&<section className="space-y-3 rounded-2xl border border-brand-border bg-card p-4">
          <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary"/><p className="font-bold">Property Profile</p></div>
          <div className="flex items-center gap-3">
            {propertyPreview || propertyPicture ? (
              <img src={propertyPreview??propertyPicture??''} alt={`${property?.name ?? code} profile preview`} className="h-16 w-16 rounded-full border object-cover"/>
            ) : (
              <span className="grid h-16 w-16 place-items-center rounded-full border bg-brand-active text-sm font-bold text-accent-foreground">{propertyInitials}</span>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold">Property picture</p>
              <p className="truncate text-xs text-muted-foreground">{propertyFile?.name??'PNG, JPG, or WebP · up to 5 MB'}</p>
              <input ref={propertyFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e=>setPropertyFile(e.target.files?.[0]??null)}/>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={()=>propertyFileRef.current?.click()}><ImagePlus className="h-4 w-4"/>Upload picture</Button>
            </div>
          </div>
          <Input aria-label="Property name" placeholder="Property name" value={propertyName} onChange={e=>setPropertyName(e.target.value)}/>
          <Input aria-label="Property code" value={code} readOnly/>
          <Input aria-label="Property address" placeholder="Location / address" value={propertyAddress} onChange={e=>setPropertyAddress(e.target.value)}/>
          <Input aria-label="Property phone" placeholder="Phone" value={propertyPhone} onChange={e=>setPropertyPhone(e.target.value)}/>
          <Button type="button" disabled={propertyBusy} onClick={savePropertyProfile}>{propertyBusy?'Saving…':'Save Property Profile'}</Button>
        </section>}

        <section className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Account</p>
          <div className="flex items-center gap-3 rounded-2xl border border-brand-border bg-card p-3">
            <span className="h-2.5 w-2.5 rounded-full bg-brand-green" />
            <div className="text-sm"><p className="font-semibold">Logged in as {session?.user_name}</p><p className="text-xs text-muted-foreground">{session?.user_email} · {session?.role}</p></div>
          </div>
          {session && <Row icon={UserPen} label="Edit Profile" onClick={()=>{setProfileName(session.user_name??'');setProfileOpen(true);}} />}
          
          
          <Row icon={RefreshCw} label="Login / Switch Account" onClick={doLogout} />
          {can(session?.role, "users") && <Row icon={Users} label="Manage Users" onClick={() => setUsersOpen(true)} />}
          <Row icon={LogOut} label="Log Out" danger onClick={() => setConfirmOut(true)} />
        </section>

        <section className="space-y-3 rounded-2xl border border-brand-border bg-brand-soft p-4">
          <p className="font-bold">Login & Security</p>
          <p className="text-sm text-muted-foreground">Current session since {session ? new Date(session.login_time).toLocaleString() : ""}</p>
          <p className="text-sm text-muted-foreground">This device stays signed in until you log out. Other devices keep their own sessions.</p>
          <Button variant="outline" className="rounded-full" disabled={!remembered} onClick={() => { clearRemembered(); setRemembered(false); }}>Clear Saved Login</Button>
          <UserAgreementReviewButton />
        </section>
        <PasskeySettings />

        {can(session?.role, "users") && <SupabaseBackupPanel propertyCode={code} />}

        <section className="space-y-2 rounded-2xl border border-brand-border bg-brand-soft p-4">
          <p className="font-bold">App Updates · {APP_NAME}</p>
          <p className="text-sm">Current Version: <b>{APP_VERSION}</b> (installed)</p>
          <p className="text-sm">Latest Stable: <b>{latest?.latestStable ?? "—"}</b></p>
          {checked && <p className="text-sm">Status: <b className={newer ? "text-brand-amber" : "text-accent-foreground"}>{newer ? "Update Available" : "Up to date"}</b></p>}
          {latest?.releaseNotes && <p className="text-xs text-muted-foreground">{newer ? latest.releaseNotes : "Up to date"}</p>}
          {updateError && <p role="alert" className="text-sm text-destructive">{updateError}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="rounded-full" disabled={updateBusy} onClick={check}>{updateBusy ? 'Please wait…' : 'Check for Updates'}</Button>
            {newer && (!isAndroidApp || latest?.apkUrl)
              && <Button className="rounded-full" onClick={() => setUpdateOpen(true)}>{updateButtonLabel}</Button>}
            {newer && isAndroidApp && !latest?.apkUrl
              && <p role="status" className="text-sm text-muted-foreground">No Android installer is available for this release.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-brand-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Contact</p>
          <p className="mt-1 font-bold">{APP_NAME} Support</p>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-2 flex items-center gap-2 text-sm text-primary"><Mail className="h-4 w-4" /> {SUPPORT_EMAIL}</a>
          
        </section>
      </div>

      <Dialog open={confirmOut} onOpenChange={setConfirmOut}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>Log out?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Your rooms and reservations will stay. If Remember is ticked you can log back quickly.</p>
          <div className="flex gap-2"><Button variant="destructive" className="rounded-full" onClick={doLogout}>Log Out</Button><Button variant="outline" className="rounded-full" onClick={() => setConfirmOut(false)}>Cancel</Button></div>
        </DialogContent>
      </Dialog>
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>Update {APP_NAME} to v{latest?.latestStable}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Updating will not delete your saved data. You can also keep using this version for now.</p>
          {updateError && <p role="alert" className="text-sm text-destructive">{updateError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="rounded-full" disabled={updateBusy} onClick={() => setUpdateOpen(false)}>Not now</Button>
            <Button className="rounded-full" disabled={updateBusy} onClick={doUpdate}>{updateBusy ? 'Updating…' : 'Update'}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Profile</DialogTitle></DialogHeader>
          {can(session?.role, "profile_edit") ? (
            <>
              <Input aria-label="Display name" value={profileName} onChange={e=>setProfileName(e.target.value)} />
              <Button onClick={async()=>{if(!session)return;const result=await supabase.from("profiles").update({name:profileName}).eq("id",session.token);if(result.error)toast.error(result.error.message);else{write(keys.session,{...session,user_name:profileName},false);setProfileOpen(false);}}}>Save Profile</Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Your profile details are managed by your property administrator.</p>
          )}
          {session && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setProfileOpen(false);
                setPasswordOpen(true);
              }}
            >
              Change Password
            </Button>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}><DialogContent><DialogHeader><DialogTitle>Change Password</DialogTitle></DialogHeader><Input type="password" placeholder="Current password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)}/><Input type="password" placeholder="New password (8 characters minimum)" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/><Button disabled={newPassword.length<8||!currentPassword} onClick={async()=>{const result=await supabase.auth.updateUser({password:newPassword,current_password:currentPassword});if(result.error)toast.error(result.error.message);else{setPasswordOpen(false);setNewPassword('');setCurrentPassword('');toast.success('Password changed');}}}>Change Password</Button></DialogContent></Dialog>
      <ManageUsers open={usersOpen} onOpenChange={setUsersOpen} actorRole={session?.role} actorId={session?.token} />
    </AppShell>
  );
}

function ManageUsers({
  open,
  onOpenChange,
  actorRole,
  actorId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  actorRole: Role | undefined;
  actorId: string | undefined;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("Front Desk");
  const [staff, setStaff] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const isManagementRole = role === "Admin" || role === "Manager" || role === "Supervisor";
  const validCompanyEmail = isValidEmail(email);
  const validLoginEmail = isValidEmail(loginIdentifier);
  const refresh = async () => {
    try {
      const result = await manageStaff({ data: { action: "list" } });
      setStaff(result as User[]);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (open) void refresh();
  }, [open]);
  const add = async () => {
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sendPasswordReset = async (member: User) => {
    setError("");
    setStatus("");
    try {
      await manageStaff({ data: { action: "send_password_reset", id: member.id } });
      setStatus(`A password reset email was requested for ${member.loginIdentifier}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle>Manage Staff</DialogTitle>
        </DialogHeader>
        <ul className="space-y-1">
          {staff.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between rounded-xl bg-brand-soft px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate">
                  {u.name} · {u.email}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {u.loginIdentifier}
                </span>
                <span className="text-xs text-muted-foreground">{u.role}</span>
              </span>
              {!["Admin", "Manager", "Supervisor"].includes(u.role) && (
                <Button size="sm" variant="outline" onClick={() => void sendPasswordReset(u)}>
                  Send password reset link
                </Button>
              )}
              {actorRole === "Admin" &&
                ["Admin", "Manager", "Supervisor"].includes(u.role) &&
                u.id !== actorId &&
                (u.loginIdentifier?.includes("@") ? (
                  <Button size="sm" variant="outline" onClick={() => void sendPasswordReset(u)}>
                    Send reset email
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Needs a management email</span>
                ))}
              {u.role !== "Admin" && (
                <div className="flex gap-2">
                  <select
                    aria-label={`Role for ${u.name}`}
                    value={u.role}
                    onChange={async (e) => {
                      try {
                        await manageStaff({
                          data: { action: "update", id: u.id, role: e.target.value as Role },
                        });
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      if (!window.confirm(`Delete ${u.name}?`)) return;
                      try {
                        await manageStaff({ data: { action: "delete", id: u.id } });
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Staff receive the property code and a secure password setup link at their sign-in email.
          Admins, managers and supervisors use email and password.
        </p>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Input
            aria-label="Staff full name"
            placeholder="Staff full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            aria-label={isManagementRole ? "Company email" : "Staff email"}
            type="email"
            placeholder={isManagementRole ? "Company email" : "Staff email"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
                onChange={(e) => setLoginIdentifier(e.target.value)}
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
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          )}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Permission role</p>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger aria-label="Permission role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
          <Button
            type="submit"
            className="rounded-full"
            disabled={
              busy ||
              !name.trim() ||
              !validCompanyEmail ||
              (isManagementRole && !validLoginEmail) ||
              (isManagementRole && password.length < 8)
            }
          >
            {busy ? "Creating…" : "Add Staff"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
