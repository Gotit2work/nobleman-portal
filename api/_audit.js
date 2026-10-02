// The activity log (Studio → Activity log): who did what, when, from where. Writes never fail the action
// they describe. Rows are pruned after about 13 months by api/cron.js.
import { sql } from "./_db.js";
import { isStaff } from "./_roles.js";

export function clientIp(req) {
  if (!req || !req.headers) return null;
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0];
  return String(req.headers["x-real-ip"] || fwd || "").trim().slice(0, 64) || null;
}

/**
 * audit(req, actor, "project.update", "Changed what Harbor Labs can do on Harbor Summit", { projectId, clientId })
 * actor is a user row, or null for the system (cron, sync).
 */
export async function audit(req, actor, action, summary, { projectId = null, clientId = null } = {}) {
  try {
    await sql`
      insert into audit_log (actor_id, actor_name, actor_kind, action, summary, project_id, client_id, ip)
      values (${actor ? actor.id : null}, ${actor ? actor.name : "Portal"}, ${actor ? (isStaff(actor) ? "staff" : "client") : "system"},
              ${action}, ${String(summary).slice(0, 500)}, ${projectId}, ${clientId || (actor && actor.client_id) || null}, ${clientIp(req)})`;
  } catch (err) {
    console.error("audit write failed", action, err.message);
  }
}
