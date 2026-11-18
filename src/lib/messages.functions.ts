import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { isPrivateMessageForStaff } from "./privateMessages";
import { invokeGpmMobileApi, usesGpmMobileApi } from "./gpmMobileApi";

type PrivateMessageRow = {
  id: string;
  kind: string;
  payload: Json;
  revision: number;
  deleted: boolean;
  receiver_staff_id: string | null;
  is_private: boolean;
};

const listPrivateMessagesServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await context.supabase
      .from("user_roles")
      .select("property_code")
      .eq("user_id", context.userId)
      .single();
    if (role.error) throw role.error;

    const loadPrivateRows = async (direction: "sent" | "received") => {
      const rows: PrivateMessageRow[] = [];
      for (let offset = 0; ; offset += 1000) {
        let query = context.supabase
          .from("operation_rows")
          .select("id, kind, payload, revision, deleted, receiver_staff_id, is_private")
          .eq("property_code", role.data.property_code)
          .eq("kind", "messages")
          .eq("is_private", true);
        query =
          direction === "received"
            ? query.eq("receiver_staff_id", context.userId)
            : query.filter("payload->>sender_staff_id", "eq", context.userId);

        const { data, error } = await query.order("id").range(offset, offset + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) return rows;
      }
    };

    const [sent, received] = await Promise.all([
      loadPrivateRows("sent"),
      loadPrivateRows("received"),
    ]);
    const uniqueRows = new Map<string, PrivateMessageRow>();
    for (const row of [...sent, ...received]) {
      if (row.is_private && isPrivateMessageForStaff(row.payload, context.userId)) {
        uniqueRows.set(row.id, row);
      }
    }
    return [...uniqueRows.values()];
  });

export async function listPrivateMessages(): Promise<PrivateMessageRow[]> {
  if (usesGpmMobileApi()) {
    return invokeGpmMobileApi<PrivateMessageRow[]>({ action: "list_private_messages" });
  }
  return listPrivateMessagesServer();
}
