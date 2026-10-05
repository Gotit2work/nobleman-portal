// Roles: what each person may do, on top of what each project allows (_caps.js).
//
// Every account is staff (users.role = 'admin') or client (users.role = 'client'). users.access picks the
// role inside that:
//   staff:  owner | manager | editor
//   client: approver | reviewer | viewer
// Owners can do everything, always (so nobody can lock the studio out). Owners adjust what the other roles may
// do in Studio → People → Roles; those overrides live in settings.roles and fall back to the defaults below.
//
// For clients, what they may do on a project is the project's switch AND their role's permission: a viewer
// can't leave notes even where Review versions is on.

export const STAFF_ROLES = [
  { key: "owner", label: "Owner", detail: "Everything, including settings, connections, roles, and staff." },
  { key: "manager", label: "Producer", detail: "Runs clients, people, and projects day to day." },
  { key: "editor", label: "Editor", detail: "Adds versions and files, answers notes and messages, updates progress." },
];

export const CLIENT_ROLES = [
  { key: "approver", label: "Decision maker", detail: "Reviews, approves versions, and can add teammates." },
  { key: "reviewer", label: "Reviewer", detail: "Watches and leaves notes. Can’t approve." },
  { key: "viewer", label: "Viewer", detail: "Watches and downloads. No notes or messages." },
];

// Staff permissions. `owner: true` marks the ones only owners ever have (not adjustable), so nobody can grant
// themselves more than an owner gave them.
export const STAFF_PERMS = [
  { key: "projects.create", label: "Create projects", group: "Projects" },
  { key: "projects.edit", label: "Edit projects", detail: "Name, client, video source, and what the client can do.", group: "Projects" },
  { key: "projects.progress", label: "Update progress", detail: "Stage, next milestone, review date, and reminders.", group: "Projects" },
  { key: "projects.videos", label: "Manage videos", detail: "Upload versions, add videos by link, hide or rename videos.", group: "Projects" },
  { key: "projects.delete", label: "Archive and delete projects", group: "Projects" },
  { key: "files.manage", label: "Add and remove files", group: "Projects" },
  { key: "notes.moderate", label: "Remove anyone’s notes and messages", group: "Projects" },
  { key: "shares.manage", label: "See and turn off share links", group: "Projects" },
  { key: "payments.manage", label: "Ask for and record payments", detail: "Ask a client to pay, cancel a request, or mark one paid another way.", group: "Projects" },
  { key: "clients.manage", label: "Add and edit clients", group: "Clients" },
  { key: "clients.delete", label: "Delete clients", detail: "Deletes their projects and files too.", group: "Clients" },
  { key: "people.manage", label: "Manage client people", detail: "Invite, change roles, reset passwords, remove.", group: "Clients" },
  { key: "data.export", label: "Export data", group: "Clients" },
  { key: "audit.view", label: "See the activity log", group: "Studio" },
  { key: "connections.manage", label: "Manage connections", detail: "Vimeo, Frame.io, Notion, email, Stripe.", group: "Studio" },
  { key: "staff.manage", label: "Manage staff", owner: true, group: "Studio" },
  { key: "settings.manage", label: "Change settings and roles", owner: true, group: "Studio" },
];

export const CLIENT_PERMS = [
  { key: "notes", label: "Leave notes on versions" },
  { key: "approve", label: "Approve versions or ask for changes" },
  { key: "download", label: "Download films and caption files" },
  { key: "share", label: "Create share links" },
  { key: "upload", label: "Send files and footage" },
  { key: "messages", label: "Message the studio" },
  { key: "team", label: "Add and remove teammates" },
  { key: "pay", label: "Pay the studio" },
];

const ALL_STAFF = Object.fromEntries(STAFF_PERMS.map((p) => [p.key, true]));

export const ROLE_DEFAULTS = {
  owner: ALL_STAFF,
  manager: { ...ALL_STAFF, "clients.delete": false, "connections.manage": false, "staff.manage": false, "settings.manage": false },
  editor: Object.fromEntries(STAFF_PERMS.map((p) => [p.key, ["projects.progress", "projects.videos", "files.manage"].includes(p.key)])),
  approver: { notes: true, approve: true, download: true, share: true, upload: true, messages: true, team: true, pay: true },
  reviewer: { notes: true, approve: false, download: true, share: false, upload: true, messages: true, team: false, pay: false },
  viewer: { notes: false, approve: false, download: true, share: false, upload: false, messages: false, team: false, pay: false },
};

export const isStaff = (u) => !!u && u.role === "admin";
const STAFF_KEYS = new Set(STAFF_ROLES.map((r) => r.key));
const CLIENT_KEYS = new Set(CLIENT_ROLES.map((r) => r.key));

/** The person's role key, always valid for their kind of account. */
export function accessOf(u) {
  if (!u) return null;
  if (isStaff(u)) return STAFF_KEYS.has(u.access) ? u.access : "owner";
  return CLIENT_KEYS.has(u.access) ? u.access : "approver";
}

export const validAccess = (role, access) => (role === "admin" ? STAFF_KEYS : CLIENT_KEYS).has(access);

/** Every role's permissions with the owner's overrides applied. Owner-only permissions can't be granted. */
export function rolePermissions(settings) {
  const over = (settings && settings.roles) || {};
  const out = {};
  for (const [role, defs] of Object.entries(ROLE_DEFAULTS)) {
    const o = over[role] && typeof over[role] === "object" ? over[role] : {};
    const merged = {};
    for (const k of Object.keys(defs)) merged[k] = typeof o[k] === "boolean" ? o[k] : defs[k];
    if (role !== "owner") for (const p of STAFF_PERMS) if (p.owner && p.key in merged) merged[p.key] = false;
    if (role === "owner") Object.assign(merged, ALL_STAFF);
    out[role] = merged;
  }
  return out;
}

/** What this person may do: { "projects.edit": true, ... } for staff, { notes: true, ... } for clients. */
export function permsOf(u, settings) {
  return rolePermissions(settings)[accessOf(u)] || {};
}

/** May this staff member do `perm`? Clients never have staff permissions. */
export function can(u, perm, settings) {
  return isStaff(u) && !!permsOf(u, settings)[perm];
}

/**
 * What a person may do on one project: the project's switches (`projectCaps`, from capsOf) narrowed by their
 * role. Staff see and do everything a project offers. Adds `notes` (leave notes) and `team`.
 */
export function effectiveCaps(u, projectCaps, settings) {
  if (isStaff(u)) return { ...Object.fromEntries(Object.keys(projectCaps).map((k) => [k, true])), notes: true, team: false, pay: false, payfirst: false };
  const r = permsOf(u, settings);
  const c = projectCaps;
  return {
    ...c,
    notes: !!(c.review && r.notes),
    approve: !!(c.approve && r.approve),
    download: !!(c.download && r.download),
    download_source: !!(c.download_source && r.download),
    captions: !!(c.captions),
    share: !!(c.share && r.share),
    upload: !!(c.upload && r.upload),
    messages: !!(c.messages && r.messages),
    team: !!(r.team && settings.security.clientTeams && u.all_projects !== false),
    pay: !!(c.payments && r.pay),
  };
}

/** Plain-words role name for a person. */
export function roleLabel(u) {
  const a = accessOf(u);
  return [...STAFF_ROLES, ...CLIENT_ROLES].find((r) => r.key === a)?.label || a;
}
