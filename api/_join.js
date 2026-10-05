// A project's own link (/join/<token>). Staff share it with the client; anyone who opens it creates a login that
// sees this project, already let in (session.js, action "join"), or adds the project to the login they have.
// Every project gets one when it's created. The token is long and random; only its hash is used to find the
// project, and it's sealed (_crypto.js) so staff can copy the same link again. "Make a new link" replaces it:
// the old one stops working at once. Switching it off keeps it, for switching back on.
import { sql } from "./_db.js";
import { randomToken, hashToken, seal, open } from "./_crypto.js";
import { CLIENT_ROLES } from "./_roles.js";

export const JOIN_ROLE = "approver";
const TOKEN_RE = /^[\w-]{20,64}$/;

export const joinRole = (p) => (CLIENT_ROLES.some((r) => r.key === p.join_access) ? p.join_access : JOIN_ROLE);

/** Gives a project a new link (replacing any old one) and returns its token. */
export async function newJoinLink(projectId) {
  const token = randomToken(18);
  await sql`update projects set join_hash = ${hashToken(token)}, join_enc = ${seal(token)}, join_off = false where id = ${projectId}`;
  return token;
}

/** The project's link token, making one first if it has none (and wasn't switched off). Null when it's off. */
export async function joinToken(p) {
  if (p.join_off) return null;
  const t = p.join_enc ? open(p.join_enc) : null;
  if (t) return t;
  // Only if it still has none, so two people opening Studio at once can't replace each other's new link.
  const token = randomToken(18);
  const [row] = await sql`update projects set join_hash = ${hashToken(token)}, join_enc = ${seal(token)}
                          where id = ${p.id} and join_hash is null returning id`;
  if (row) return token;
  const cur = (await sql`select join_enc, join_off from projects where id = ${p.id}`)[0];
  return cur && !cur.join_off && cur.join_enc ? open(cur.join_enc) : null;
}

export const joinUrl = (origin, token) => (token ? `${origin}/join/${token}` : null);

/** The active project a link opens, with its client's name, or null (wrong, replaced, switched off, archived). */
export async function projectByJoin(token) {
  const t = String(token || "");
  if (!TOKEN_RE.test(t)) return null;
  const p = (await sql`select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id
                       where p.join_hash = ${hashToken(t)} limit 1`)[0];
  return p && !p.join_off && !p.archived ? p : null;
}

/** Lets a person see a project (idempotent). Returns true when they didn't have it before. */
export async function addToProject(userId, projectId, how = "link") {
  const r = await sql`insert into project_people (project_id, user_id, how) values (${projectId}, ${userId}, ${how})
                      on conflict (project_id, user_id) do nothing returning project_id`;
  return r.length > 0;
}
