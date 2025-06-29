import { db } from "../lib/firebase";

const TIMEOUT = 2 * 60 * 1000;

export default async function handler(req, res) {
  const snap = await db.ref("online_status").once("value");
  const apps = snap.val() || {};
  const now = Date.now();
  let removed = 0;

  for (const app in apps) {
    for (const user in apps[app]) {
      if (now - apps[app][user] >= TIMEOUT) {
        await db.ref(`online_status/${app}/${user}`).remove();
        removed++;
      }
    }
  }

  res.setHeader("Content-Type", "text/plain");
  res.send(`Cleaned ${removed} inactive users`);
}