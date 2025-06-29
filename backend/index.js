const express = require("express");
const { db } = require("./lib/firebase");
const { checkRate } = require("./lib/ratelimit");

const app = express();
const PORT = 3000;
const TIMEOUT = 2 * 60 * 1000;

function ipToId(ip) {
  return (
    "u" +
    ip
      .split("")
      .reduce((a, c, i) => a + c.charCodeAt(0) * (i + 1), 0)
      .toString(36)
  );
}

app.use((req, res, next) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    "unknown";
  if (!checkRate(ip)) return res.status(429).send("Rate limit exceeded");
  next();
});

app.get("/ping", async (req, res) => {
  let { appId, app } = req.query;
  appId = appId || app;
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
  const myId = ipToId(ip);
  console.log(appId, myId);
  if (!appId && !myId) return res.status(400).send("Missing app or myId");

  const ref = db.ref(`online_status/${appId}/${myId}`);
  await ref.set(Date.now());

  const snap = await db.ref(`online_status/${appId}`).once("value");
  const data = snap.val() || {};
  const now = Date.now();
  let count = 0;

  for (const key in data) {
    if (now - data[key] < TIMEOUT) count++;
    else db.ref(`online_status/${appId}/${key}`).remove();
  }

  res.type("text").send(count.toString());
});

app.get("/leave", async (req, res) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
  const myId = ipToId(ip);
  let { appId, app } = req.query;
  appId = appId || app;
  if (!appId || !myId) return res.status(400).send("Missing app or myId");

  await db.ref(`online_status/${appId}/${myId}`).remove();
  res.type("text").send("0");
});

app.get("/get", async (req, res) => {
  let { appId, app } = req.query;
  appId = appId || app;
  if (!appId) return res.status(400).send("Missing app");

  const snap = await db.ref(`online_status/${appId}`).once("value");
  const data = snap.val() || {};
  const now = Date.now();
  let count = 0;

  for (const key in data) {
    if (now - data[key] < TIMEOUT) count++;
  }

  res.type("text").send(count.toString());
});

app.get("/app", (req, res) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
  const myId = ipToId(ip);
  if (!myId) return res.status(400).send("Missing myId");
  res.type("text").send(myId.toString());
});

app.get("/app/:id", (req, res) => {
  res.type("text").send(req.params.id);
});

app.get("/cleanup", async (req, res) => {
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

  res.type("text").send(`Cleaned ${removed} inactive users`);
});

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>IsLive</title>
      <style>
        body { font-family: sans-serif; background: #111; color: #eee; padding: 2rem; line-height: 1.6; }
        code { background: #222; padding: 2px 6px; border-radius: 4px; }
        h1, h2 { color: #0f0; }
        a { color: #6cf; }
        #counter { font-size: 2rem; color: #0f0; margin-top: 0.5rem; }
      </style>
    </head>
    <body>
      <h1>IsLive API</h1>
      <p>This API tracks online users per app using hashed IPs as unique IDs (no manual ID upload).</p>
      <p>Base URL: <code>https://islive.alimad.xyz</code></p>
      <div id="counter">Loading...</div>

      <h2>Endpoints</h2>

      <h3><code>GET /ping?app=APPID</code></h3>
      <p>Registers the user's presence under <code>APPID</code> and returns current total online users.</p>

      <h3><code>GET /leave?app=APPID</code></h3>
      <p>Removes the user from <code>APPID</code>'s online list.</p>

      <h3><code>GET /get?app=APPID</code></h3>
      <p>Returns number of online users for <code>APPID</code> without affecting presence.</p>

      <h3><code>GET /app</code></h3>
      <p>Returns your generated user ID (based on IP).</p>

      <h3><code>GET /app/ID</code></h3>
      <p>Returns the same <code>ID</code> string you pass. Useful for testing.</p>

      <h2>Rate Limit</h2>
      <p>Each IP can ping up to <strong>50 times per minute</strong>.</p>

      <h2>Notes</h2>
      <ul>
        <li>IP-based IDs are obfuscated and consistent, but not reversible.</li>
        <li>Presence times out after ~2 minutes of inactivity.</li>
        <li>No user data is stored beyond minimal session info.</li>
      </ul>

      <h2>Source</h2>
      <p>GitHub: <a href="https://Alimadcorp.github.io/isonline" target="_blank">Alimadcorp.github.io/isonline</a></p>

      <script>
        async function updateCounter() {
          try {
            const res = await fetch("/ping?appId=islive");
            const text = await res.text();
            document.getElementById("counter").textContent = text + " users are currently viewing this page";
          } catch {
            document.getElementById("counter").textContent = "Uhhhh";
          }
        }
        updateCounter();
        setInterval(updateCounter, 5000);
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`IsOnline API running at http://localhost:${PORT}`);
});
