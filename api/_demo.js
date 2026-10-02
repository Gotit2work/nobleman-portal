import { CAPABILITIES, STAGES } from "./_caps.js";
import { DEFAULTS } from "./_settings.js";
import { ROLE_DEFAULTS } from "./_roles.js";

// The public sample portal (/demo, and / when PORTAL_MODE=demo). Same shape as buildPortal() in _build.js, so
// the page renders it exactly like real data. Everything is made up; every film plays Nobleman's reel. Notes
// and messages are included inline, and nothing the visitor does is saved or sent (the page says so).

const REEL = { playback: { kind: "vimeo", id: "1197058424", hash: "796798a19d" } };
const ago = (days, hours = 0) => new Date(Date.now() - (days * 24 + hours) * 3600 * 1000).toISOString();
const ahead = (days) => new Date(Date.now() + days * 24 * 3600 * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric" });
const ahead8601 = (days) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
// What a decision maker sees: everything on except earlier versions, so only the newest version shows.
const allCaps = { ...Object.fromEntries(CAPABILITIES.map((c) => [c.key, true])), history: false, notes: true, team: true };

function film(id, title, extra) {
  return { id, ...REEL, title, description: "", duration: 0, durationLabel: "", resolution: "4K", vertical: false, created: ago(9), thumbnail: null, plays: null, ...extra };
}

export function demoPortal() {
  const v3 = film("demo-campaign-v3", "Campaign Film", { durationLabel: "4:21", duration: 261, created: ago(4), thumbnail: "media/a00.jpg", description: "Opening reworked around the wide shot. Color adjusted on the water scenes." });
  const s1 = film("demo-cutdown-v1", "15-Second Cutdown", { durationLabel: "0:15", duration: 15, created: ago(3), thumbnail: "media/a08.jpg", description: "The short version for social ads." });

  const meridian = {
    id: "demo-meridian",
    title: "Meridian Campaign",
    type: "Brand campaign · Commercial",
    summary: "A four-minute brand film, a TV commercial, and short versions for social, filmed on the water off San Diego.",
    clientId: "demo-client", clientName: "Meridian",
    stage: 3, stageName: STAGES[3], pct: 72,
    next: { label: "Next", date: ahead(4), what: "Final polish (color and sound) once Version 3 is approved", confirm: false, confirmedAt: null, confirmedBy: null },
    reviewDue: ahead8601(2),
    cover: "media/a00.jpg",
    caps: allCaps,
    provider: "vimeo",
    videoUploadsToSource: true,
    // Versions 1 and 2 had notes and change requests; clients see only the newest (Earlier versions is off).
    cuts: [
      { key: "campaign film", title: "Campaign Film", total: 3, versions: [
        { n: 3, video: v3, decision: null, comments: { total: 3, open: 2 } },
      ] },
      { key: "15-second cutdown", title: "15-Second Cutdown", total: 1, versions: [
        { n: 1, video: s1, decision: null, comments: { total: 0, open: 0 } },
      ] },
    ],
    status: { key: "waiting", label: "Waiting on client" },
    films: [
      film("demo-hero", "Campaign Hero Film", { durationLabel: "4:21", duration: 261, created: ago(12), thumbnail: "media/a07.jpg", description: "The four-minute brand film, for the web, the launch event, and the dealer network.", plays: 1284 }),
      film("demo-30", "30-Second Commercial", { durationLabel: "0:30", duration: 30, created: ago(10), thumbnail: "media/a08.jpg", description: "The TV version, with stereo and surround sound.", plays: 642 }),
      film("demo-vertical", "Vertical Social Video", { durationLabel: "0:45", duration: 45, resolution: "Vertical", vertical: true, created: ago(10), thumbnail: "media/a05.jpg", description: "For Instagram Reels, YouTube Shorts, and TikTok. Captions built in.", plays: 3910 }),
      film("demo-bts", "Behind the Scenes", { durationLabel: "2:48", duration: 168, created: ago(8), thumbnail: "media/a09.jpg", description: "Three filming days on the water and in the studio.", plays: 215 }),
    ],
    videosError: null,
    files: [
      { id: "demo-f1", name: "Meridian_Quote_Signed.pdf", size: 412000, contentType: "application/pdf", kind: "document", by: "Jean", byRole: "admin", mine: false, at: ago(30) },
      { id: "demo-f2", name: "Shoot_Schedule_and_Call_Sheet.pdf", size: 1880000, contentType: "application/pdf", kind: "document", by: "Justin", byRole: "admin", mine: false, at: ago(24) },
      { id: "demo-f3", name: "Meridian_Brand_Guide_2026.pdf", size: 14200000, contentType: "application/pdf", kind: "upload", by: "Jonathan Reyes", byRole: "client", mine: true, at: ago(29) },
      { id: "demo-f4", name: "Meridian_Logo_Primary.ai", size: 2800000, contentType: "application/postscript", kind: "upload", by: "Jonathan Reyes", byRole: "client", mine: true, at: ago(29) },
    ],
    videoUploads: [
      { id: "demo-u1", vimeoId: "0", name: "Reference_Sea_Trials.mp4", size: 420000000, status: "done", by: "Jonathan Reyes", byRole: "client", mine: true, at: ago(26) },
    ],
    messages: { total: 3, unread: 1, last: ago(4) },
    updated: ago(4),
    thread: [
      { id: "demo-m1", author: "Jean", role: "admin", body: "Filming wrapped Thursday. Editing starts today; expect Version 1 within the week.", at: ago(22) },
      { id: "demo-m2", author: "Jonathan Reyes", role: "client", body: "Notes are in on Version 2. The middle section is the main one.", at: ago(8) },
      { id: "demo-m3", author: "Justin", role: "admin", body: "Version 3 is up. We reworked the opening around your note on the wide shot.", at: ago(4) },
    ],
    notes: {
      "demo-campaign-v3": [
        { id: "demo-c1", at: 12, body: "Can we hold this wide a beat longer before the cut?", author: "Jonathan Reyes", role: "client", resolved: false, when: ago(3), replies: [] },
        { id: "demo-c2", at: 41, body: "Love this shot.", author: "Jonathan Reyes", role: "client", resolved: false, when: ago(3), replies: [
          { id: "demo-c2r", body: "Thank you. That one took three passes to catch the light.", author: "Justin", role: "admin", when: ago(2) },
        ] },
        { id: "demo-c3", at: 65, body: "Swapped to the alternate angle here, as you asked.", author: "Justin", role: "admin", resolved: true, when: ago(4), replies: [] },
      ],
    },
  };

  const social = {
    id: "demo-social",
    title: "Social Content Package",
    type: "Twelve short vertical videos",
    summary: "Short vertical videos for Instagram, TikTok, and YouTube Shorts.",
    clientId: "demo-client", clientName: "Meridian",
    stage: 1, stageName: STAGES[1], pct: 28,
    next: { label: "Next filming day", date: ahead(2), what: "Day 2 of 3, San Diego. Call time 7:00 AM", confirm: true, confirmedAt: null, confirmedBy: null },
    reviewDue: null,
    cover: "media/a03.jpg",
    caps: allCaps,
    provider: "vimeo",
    videoUploadsToSource: true,
    cuts: [], films: [], videosError: null, files: [], videoUploads: [],
    status: { key: "none", label: "Nothing in review" },
    messages: { total: 0, unread: 0, last: null },
    updated: ago(6),
    thread: [], notes: {},
  };

  const P = [meridian, social];
  return {
    user: { id: "demo-user", email: "jonathan@meridian.example", name: "Jonathan Reyes", title: "Marketing Director", role: "client", access: "approver",
      roleLabel: "Decision maker", perms: ROLE_DEFAULTS.approver, clientId: "demo-client", clientName: "Meridian", clientLogo: null, mustChangePassword: false, notifyEmail: true, twoStep: false },
    demo: true,
    brand: DEFAULTS.brand,
    welcome: DEFAULTS.welcome,
    announcement: null,
    emailEnabled: true,
    stages: STAGES,
    projects: P,
    activity: [
      { type: "message", projectId: "demo-meridian", projectTitle: "Meridian Campaign", who: "Justin", role: "admin", text: "Version 3 is up. We reworked the opening around your note on the wide shot.", at: ago(4) },
      { type: "comment", projectId: "demo-meridian", projectTitle: "Meridian Campaign", who: "Jonathan Reyes", role: "client", text: "Can we hold this wide a beat longer before the cut?", at: ago(3) },
      { type: "changes", projectId: "demo-meridian", projectTitle: "Meridian Campaign", who: "Jonathan Reyes", role: "client", text: "Music works. The middle section still feels long.", at: ago(8) },
      { type: "document", projectId: "demo-meridian", projectTitle: "Meridian Campaign", who: "Justin", role: "admin", text: "Shoot_Schedule_and_Call_Sheet.pdf", at: ago(24) },
    ],
  };
}
