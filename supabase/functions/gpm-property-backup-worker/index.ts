import { createClient } from "npm:@supabase/supabase-js@2";

const bucket = "gilnet-backups";
const maxBackupBytes = 25 * 1024 * 1024;
const retentionDays = 30;
const retentionCount = 30;
const recordKinds = ["rooms", "reservations", "notices", "messages", "menu", "sales"] as const;

type BackupSchedule = "hourly" | "daily" | "weekly" | "monthly" | "after_each_entry";
type BackupJob = {
  property_code: string;
  schedule: BackupSchedule;
  queued_at: string | null;
  lease_token: string;
};
type OperationRow = {
  kind: string;
  id: string;
  payload: Record<string, unknown>;
  revision: number;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The property backup job failed.";
}

function secretsMatch(candidate: string, expected: string) {
  const left = new TextEncoder().encode(candidate);
  const right = new TextEncoder().encode(expected);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function isRecordKind(kind: string): kind is (typeof recordKinds)[number] {
  return recordKinds.includes(kind as (typeof recordKinds)[number]);
}

async function loadOperationRows(
  adminClient: ReturnType<typeof createClient>,
  propertyCode: string,
) {
  const rows: OperationRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await adminClient
      .from("operation_rows")
      .select("kind,id,payload,revision")
      .eq("property_code", propertyCode)
      .eq("deleted", false)
      .eq("is_private", false)
      .order("kind")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw new Error(`Could not read cloud records: ${error.message}`);
    rows.push(...((data ?? []) as OperationRow[]));
    if (!data || data.length < 1000) return rows;
  }
}

async function createPropertySnapshot(
  adminClient: ReturnType<typeof createClient>,
  propertyCode: string,
) {
  if (!/^[A-Z0-9 _-]{1,32}$/.test(propertyCode)) {
    throw new Error("The property code is invalid.");
  }
  const [{ data: property, error: propertyError }, rows] = await Promise.all([
    adminClient
      .from("properties")
      .select("name,address,phone,property_type,billing_email,image_url")
      .eq("code", propertyCode)
      .maybeSingle(),
    loadOperationRows(adminClient, propertyCode),
  ]);
  if (propertyError) throw new Error(`Could not read property details: ${propertyError.message}`);
  if (!property) throw new Error("The property no longer exists.");

  const records: Record<string, unknown> = {
    [`gilnet_cloud250_property_${propertyCode}`]: property,
    [`gilnet_cloud250_outbox_${propertyCode}`]: {},
  };
  const groups = new Map<(typeof recordKinds)[number], Record<string, unknown>[]>();
  const revisions: Record<string, number> = {};
  for (const kind of recordKinds) groups.set(kind, []);
  for (const row of rows) {
    if (!isRecordKind(row.kind)) continue;
    groups.get(row.kind)?.push(row.payload);
    revisions[`${row.kind}:${row.id}`] = row.revision;
  }
  for (const [kind, group] of groups) {
    if (kind === "messages") {
      records[`gilnet_cloud250_messages_${propertyCode}_All Staff`] = group;
    } else {
      records[`gilnet_cloud250_${kind}_${propertyCode}`] = group;
    }
  }
  records[`gilnet_cloud250_revisions_${propertyCode}`] = revisions;

  const backup = {
    format: "gilnet-property-backup",
    version: 1,
    propertyCode,
    createdAt: new Date().toISOString(),
    records,
  };
  const body = JSON.stringify(backup);
  if (new TextEncoder().encode(body).byteLength > maxBackupBytes) {
    throw new Error("This property backup exceeds 25 MB.");
  }
  return { body, recordCount: Object.keys(records).length };
}

async function removeExpiredBackups(
  adminClient: ReturnType<typeof createClient>,
  propertyCode: string,
) {
  const { data, error } = await adminClient.storage.from(bucket).list(propertyCode, {
    limit: 1000,
    sortBy: { column: "name", order: "desc" },
  });
  if (error) throw new Error(`Could not check backup retention: ${error.message}`);

  const backups = (data ?? [])
    .filter((entry) => entry.id && /^backup-\d+\.json$/.test(entry.name))
    .sort(
      (left, right) =>
        Number(right.name.slice("backup-".length, -".json".length)) -
        Number(left.name.slice("backup-".length, -".json".length)),
    );
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const pathsToDelete = backups
    .filter((file, index) => {
      const timestamp = Number(file.name.slice("backup-".length, -".json".length));
      return index >= retentionCount || timestamp < cutoff;
    })
    .map((file) => `${propertyCode}/${file.name}`);
  if (!pathsToDelete.length) return;

  const { error: deleteError } = await adminClient.storage.from(bucket).remove(pathsToDelete);
  if (deleteError) throw new Error(`Could not rotate old backups: ${deleteError.message}`);
}

async function recordRun(
  adminClient: ReturnType<typeof createClient>,
  job: BackupJob,
  result: {
    status: "success" | "failure";
    path?: string;
    recordCount?: number;
    errorMessage?: string;
  },
) {
  const { error } = await adminClient.from("property_backup_runs").insert({
    property_code: job.property_code,
    schedule: job.schedule,
    trigger_type: job.schedule === "after_each_entry" ? "entry" : "scheduled",
    status: result.status,
    backup_path: result.path ?? null,
    record_count: result.recordCount ?? null,
    error_message: result.errorMessage?.slice(0, 800) ?? null,
  });
  if (error) throw new Error(`Could not record backup status: ${error.message}`);
}

async function failJob(adminClient: ReturnType<typeof createClient>, job: BackupJob, message: string) {
  const safeMessage = message.slice(0, 800);
  const { error } = await adminClient.rpc("gpm_fail_property_backup_job", {
    p_property_code: job.property_code,
    p_lease_token: job.lease_token,
    p_queued_at: job.queued_at,
    p_error_message: safeMessage,
  });
  if (error) console.error("Could not release failed property backup job.", error);
  try {
    await recordRun(adminClient, job, { status: "failure", errorMessage: safeMessage });
  } catch (recordError) {
    console.error("Could not save property backup failure status.", recordError);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const expectedSecret = Deno.env.get("GPM_BACKUP_CRON_SECRET");
  if (!expectedSecret) {
    console.error("GPM_BACKUP_CRON_SECRET is not configured.");
    return jsonResponse({ error: "The property backup worker is not configured." }, 500);
  }
  const presentedSecret = request.headers.get("x-gpm-backup-secret") ?? "";
  if (!secretsMatch(presentedSecret, expectedSecret)) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase URL or server-side service-role key is not configured.");
    return jsonResponse({ error: "The property backup worker is not configured." }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: jobs, error: claimError } = await adminClient.rpc(
    "gpm_claim_property_backup_jobs",
    { p_limit: 25 },
  );
  if (claimError || !jobs) {
    console.error("Could not claim property backup jobs.", claimError);
    return jsonResponse({ error: "Property backup jobs could not be claimed." }, 500);
  }

  const results: { propertyCode: string; status: "success" | "failure" }[] = [];
  for (const job of jobs as BackupJob[]) {
    try {
      const { body, recordCount } = await createPropertySnapshot(adminClient, job.property_code);
      const path = `${job.property_code}/backup-${Date.now()}.json`;
      const { error: uploadError } = await adminClient.storage.from(bucket).upload(path, body, {
        contentType: "application/json",
        upsert: true,
      });
      if (uploadError) throw new Error(`Could not upload the property backup: ${uploadError.message}`);

      await removeExpiredBackups(adminClient, job.property_code);
      await recordRun(adminClient, job, { status: "success", path, recordCount });
      const { error: completeError } = await adminClient.rpc("gpm_complete_property_backup_job", {
        p_property_code: job.property_code,
        p_lease_token: job.lease_token,
        p_queued_at: job.queued_at,
      });
      if (completeError) throw new Error(`Could not complete the backup job: ${completeError.message}`);
      results.push({ propertyCode: job.property_code, status: "success" });
    } catch (error) {
      const message = errorMessage(error);
      console.error(`Property backup failed for ${job.property_code}.`, error);
      await failJob(adminClient, job, message);
      results.push({ propertyCode: job.property_code, status: "failure" });
    }
  }
  return jsonResponse({ processed: results.length, results });
});
