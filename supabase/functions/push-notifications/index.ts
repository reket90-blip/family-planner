import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
async function getPushConfig() {
  const { data, error } = await admin.rpc("get_push_runtime_config").maybeSingle();
  if (error) throw error;
  return data as { public_key: string; private_key: string; cron_secret: string } | null;
}
async function hasInternalAuthorization(req: Request) {
  const config = await getPushConfig();
  return Boolean(config?.cron_secret && req.headers.get("authorization") === `Bearer ${config.cron_secret}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }

  if (body.action === "invite-owner") {
    try {
      if (!await hasInternalAuthorization(req)) return json(401, { error: "unauthorized" });
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: "invalid_email" });
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
      if (error) return json(400, { error: "invite_failed", detail: error.message.slice(0,300) });
      return json(200, { ok: true, invited: Boolean(data.user?.id) });
    } catch (err) {
      return json(500, { error: "invite_failed", detail: String((err as Error)?.message ?? err).slice(0,300) });
    }
  }

  if (body.action === "send-due") {
    try {
      const config = await getPushConfig();
      if (!config?.cron_secret || req.headers.get("authorization") !== `Bearer ${config.cron_secret}`) {
        return json(401, { error: "unauthorized" });
      }
      if (!config.public_key || !config.private_key) return json(503, { error: "push_not_configured" });
      webpush.setVapidDetails("mailto:planner-notifications@example.com", config.public_key, config.private_key);
      const { data: dueItems, error: dueError } = await admin.rpc("get_due_planner_reminders");
      if (dueError) throw dueError;
      let sent = 0, skipped = 0, failed = 0;
      for (const item of (dueItems ?? [])) {
        const scheduledFor = new Date(item.due_at).toISOString();
        const { data: claim, error: claimError } = await admin
          .from("push_delivery_log")
          .upsert({
            user_id: item.user_id, item_id: item.item_id, scheduled_for: scheduledFor,
            status: "queued", error: "",
          }, { onConflict: "item_id,scheduled_for", ignoreDuplicates: true })
          .select("id").maybeSingle();
        if (claimError) throw claimError;
        if (!claim) { skipped++; continue; }
        const { data: subscriptions, error: subsError } = await admin
          .from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", item.user_id);
        if (subsError) throw subsError;
        if (!subscriptions?.length) {
          await admin.from("push_delivery_log").update({ status: "skipped", error: "No active push subscription" }).eq("id", claim.id);
          skipped++;
          continue;
        }
        const payload = JSON.stringify({
          title: "Наш планер 🌿",
          body: item.title + (item.event_time ? ` · ${String(item.event_time).slice(0,5)}` : ""),
          tag: `planner-${item.item_id}`,
          data: { url: "./", itemId: item.item_id, category: item.category ?? "Событие" },
        });
        const errors: string[] = [];
        let delivered = 0;
        for (const sub of subscriptions) {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
            delivered++;
          } catch (err) {
            const e = err as { statusCode?: number; message?: string };
            errors.push(String(e.message ?? err).slice(0, 240));
            if (e.statusCode === 404 || e.statusCode === 410) {
              await admin.from("push_subscriptions").delete().eq("id", sub.id);
            }
          }
        }
        if (delivered > 0) {
          await admin.from("push_delivery_log").update({ status: "sent", delivered_at: new Date().toISOString(), error: errors.join("; ").slice(0,1000) }).eq("id", claim.id);
          sent++;
        } else {
          await admin.from("push_delivery_log").update({ status: "failed", error: errors.join("; ").slice(0,1000) || "Push delivery failed" }).eq("id", claim.id);
          failed++;
        }
      }
      return json(200, { ok: true, checked: dueItems?.length ?? 0, sent, skipped, failed });
    } catch (err) {
      return json(500, { error: "delivery_failed", detail: String((err as Error)?.message ?? err).slice(0,500) });
    }
  }

  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return json(401, { error: "sign_in_required" });
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: "invalid_session" });
  const userId = userData.user.id;

  if (body.action === "public-key") {
    try {
      const config = await getPushConfig();
      if (!config?.public_key) return json(503, { error: "push_not_configured" });
      return json(200, { publicKey: config.public_key });
    } catch { return json(500, { error: "configuration_unavailable" }); }
  }
  if (body.action === "subscribe") {
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth ||
        typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") ||
        typeof sub.keys.p256dh !== "string" || typeof sub.keys.auth !== "string") {
      return json(400, { error: "invalid_subscription" });
    }
    const { error } = await admin.from("push_subscriptions").upsert({
      user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh,
      auth: sub.keys.auth, user_agent: String(body.userAgent ?? "").slice(0,500),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,endpoint" });
    if (error) return json(500, { error: "subscription_save_failed" });
    return json(200, { ok: true });
  }
  if (body.action === "unsubscribe") {
    const endpoint = body.endpoint;
    if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) return json(400, { error: "invalid_endpoint" });
    const { error } = await admin.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
    if (error) return json(500, { error: "subscription_remove_failed" });
    return json(200, { ok: true });
  }
  return json(400, { error: "unknown_action" });
});
