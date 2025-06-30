const express = require("express");
const cors = require("cors");
const { db } = require("./lib/firebase");
const { checkRate } = require("./lib/ratelimit");
const { ipToId } = require("./lib/ipToId");
const { validate } = require("./lib/validate");
const { page } = require("./lib/page");

const app = express();
app.use(cors());
const PORT = 5500;
const TIMEOUT = 2 * 60 * 1000;
function dateParse(date) {
  if (date == 0 || date == "0") return new Date(0);
  const match = /^(\d{1,2})-(\d{1,2})-(\d{2,4})T(\d{1,2})$/.exec(date);
  if (!match) return null;

  let [_, day, month, year, hour] = match;

  day = day.padStart(2, "0");
  month = month.padStart(2, "0");
  hour = hour.padStart(2, "0");

  const isoString = `${year}-${month}-${day}T${hour}:00:00.000Z`;
  return new Date(isoString);
}

function getIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

app.use((req, res, next) => {
  const ip = getIp(req);
  if (!checkRate(ip)) return res.status(429).send("Rate limit exceeded");
  next();
});

app.get("/ping", async (req, res) => {
  let { app } = req.query;
  let t = validate(app);
  if (!t.valid) {
    return res.status(400).send(t);
  }
  app = t.id;
  const ip = getIp(req);
  const myId = ipToId(ip);
  //console.log(app, myId, ip);
  if (!app && !myId) return res.status(400).send("Missing app or myId");

  const ref = db.ref(`online_status/${app}/${myId}`);
  await ref.set(Date.now());

  const snap = await db.ref(`online_status/${app}`).once("value");
  const data = snap.val() || {};
  const now = Date.now();
  let count = 0;

  for (const key in data) {
    if (now - data[key] < TIMEOUT) count++;
    else db.ref(`online_status/${app}/${key}`).remove();
  }

  res.type("text").send(count.toString());

  const today = new Date();
  const dayKey = `${today.getDate()}-${
    today.getMonth() + 1
  }-${today.getFullYear()}T${today.getHours()}`;
  const statsRef = db.ref(`stats/${app}`);
  const statsSnap = await statsRef.once("value");

  const stats = statsSnap.val() || {
    pings: {},
    totalPings: 0,
    uniqueIds: 0,
    registeredIds: [],
    lastPing: 0,
    maxConcurrent: { overall: 0 },
  };
  stats.pings[dayKey] = (stats.pings[dayKey] || 0) + 1;
  stats.totalPings += 1;
  if (!stats.registeredIds.includes(myId)) {
    stats.registeredIds.push(myId);
    stats.uniqueIds = stats.registeredIds.length;
  }
  stats.lastPing = Date.now();
  stats.maxConcurrent = stats.maxConcurrent || {};
  const currentOnline = count;

  if (
    !stats.maxConcurrent[dayKey] ||
    currentOnline > stats.maxConcurrent[dayKey]
  ) {
    stats.maxConcurrent[dayKey] = currentOnline;
  }
  if (
    !stats.maxConcurrent.overall ||
    currentOnline > stats.maxConcurrent.overall
  ) {
    stats.maxConcurrent.overall = currentOnline;
  }

  await statsRef.set(stats);
});

app.get("/stats", async (req, res) => {
  let { app } = req.query;
  let t = validate(app);
  if (!t.valid) return res.status(400).json(t);
  app = t.id;
  const snap = await db.ref(`stats/${app}`).once("value");
  let data = snap.val() || {
    pings: {},
    totalPings: 0,
    uniqueIds: 0,
    lastPing: new Date(0),
    registeredIds: [],
    maxConcurrent: {
      overall: 0,
    },
  };
  let p = Object.fromEntries(
    Object.entries(data.pings).map(([key, value]) => [
      dateParse(key)?.toISOString() || key,
      value,
    ])
  );
  let m = Object.fromEntries(
    Object.entries(data.maxConcurrent).map(([key, value]) => [
      dateParse(key)?.toISOString() || key,
      value,
    ])
  );
  data.pings = p;
  data.maxConcurrent = m;
  delete data.registeredIds;
  res.json(data);
});

app.get("/leave", async (req, res) => {
  const ip = getIp(req);
  const myId = ipToId(ip);
  let { app } = req.query;
  let t = validate(app);
  if (!t.valid) {
    return res.status(400).send(t);
  }
  app = t.id;
  if (!app || !myId) return res.status(400).send("Missing app or myId");

  await db.ref(`online_status/${app}/${myId}`).remove();
  res.type("text").send("Done");
});

app.get("/get", async (req, res) => {
  let { app } = req.query;
  let t = validate(app);
  if (!t.valid) {
    return res.status(400).send(t);
  }
  app = t.id;
  if (!app.includes(",")) app = [app];
  else app = app.split(",");
  if (!Array.isArray(app))
    return res.status(400).send("Failed to parse app list");
  app = app.slice(0, 64);

  for (const id of app) {
    const t = validate(id);
    if (!t.valid) {
      return res.status(400).send(`Invalid app ID: ${id}`);
    }
  }

  const now = Date.now();
  let total = 0;

  for (const appId of app) {
    const snap = await db.ref(`online_status/${appId}`).once("value");
    const data = snap.val() || {};
    for (const key in data) {
      if (now - data[key] < TIMEOUT) total++;
    }
  }

  res.type("text").send(total.toString());
});

// End of main API
function base64toString(str) {
  return atob(str.replaceAll("-", "+").replaceAll("_", "/"));
}

app.get(`/admin/${process.env.adwinPassword}`, async (req, res) => {
  const token = req.query.key;
  const action = req.query.action;
  let app = req.query.app;
  if (token !== process.env.otherPassword) {
    return res.sendStatus(404);
  }
  if (!action) return res.send("no action :)");
  if (action == "checkout") {
    const snap = await db
      .ref("online_status" + (app ? `/${btoa(app)}` : ""))
      .once("value");
    let val = snap.val();
    if (!app) {
      let r = {};
      let k = Object.keys(val);
      for (let i = 0; i < k.length; i++) {
        r[base64toString(k[i])] = val[k[i]];
      }
      return res.send(r);
    }
    return res.send(val);
  }
  if (action == "checkoutstats") {
    const snap = await db.ref("stats").once("value");
    let val = snap.val();
    let r = {};
    let k = Object.keys(val);
    for (let i = 0; i < k.length; i++) {
      r[base64toString(k[i])] = val[k[i]];
    }
    return res.send(r);
  }
  if (action == "clear") {
    let snap = await db
      .ref("online_status" + (app ? `/${btoa(app)}` : ""))
      .once("value");
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
  }
});

app.get("/", (req, res) => {
  res.type("html").send(atob(page));
});

app.get("/stats/view", async (req, res) => {
  let { app } = req.query;
  const t = validate(app);
  if (!t.valid) return res.status(400).send(t.error);
  app = t.id;
  const snap = await db.ref(`stats/${app}`).once("value");
  const data = snap.val() || { pings: {}, maxConcurrent: {} };
  const labels = Object.keys(data.pings || {});
  const values = Object.values(data.pings || {});

  let concurrent = labels.map((d) => data.maxConcurrent?.[d] || 0);
  const maxPing = Math.max(...values, 1);
  const maxConcurrent = Math.max(...concurrent, 1);
  const normalizedConcurrent = concurrent.map((v) =>
    Math.round((v / maxConcurrent) * maxPing)
  );

  const concurrentJSON = JSON.stringify(concurrent);
  const labelJSON = JSON.stringify(labels);
  const valueJSON = JSON.stringify(values);
  const normalizedJSON = JSON.stringify(normalizedConcurrent);
  app = base64toString(app);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Stats for ${app}</title>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>
        body { font-family: sans-serif; background: #111; color: #eee; padding: 2rem }
        canvas { max-width: 700px; margin: 2rem auto; display: block; background: #000; border-radius: 8px }
      </style>
    </head>
    <body>
      <h1>Stats for <code>${app}</code></h1>
      <p><strong>Total Pings:</strong> ${data.totalPings || 0}</p>
      <p><strong>Unique Users:</strong> ${data.uniqueIds || 0}</p>
      <p><strong>Last Ping:</strong> ${new Date(
        data.lastPing || 0
      ).toLocaleString()}</p>
      <p><strong>Max Concurrent (Last Hour):</strong> ${
        data.maxConcurrent?.[labels.at(-1)] || 0
      }</p>
      <p><strong>Max Concurrent (All Time):</strong> ${
        data.maxConcurrent?.overall || 0
      }</p>

      <canvas id="pingChart" width="700" height="400"></canvas>
      <script>
        const concurrent = ${concurrentJSON};
        const ctx = document.getElementById('pingChart').getContext('2d');
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: ${labelJSON},
            datasets: [
              {
                label: 'Pings per Hour',
                data: ${valueJSON},
                borderColor: 'lime',
                backgroundColor: 'rgba(0,255,0,0.1)',
                tension: 0.3,
                yAxisID: 'y'
              },
              {
                label: 'Max Concurrent Users',
                data: ${normalizedJSON},
                borderColor: '#0af',
                backgroundColor: 'rgba(0,170,255,0.1)',
                tension: 0.3,
                yAxisID: 'y'
              }
            ]
          },
          options: {
            responsive: true,
            plugins: {
              legend: { labels: { color: "#eee" } },
              title: {
                display: true,
                text: 'Hourly Ping Activity with Concurrent Users',
                color: "#eee"
              },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    const label = ctx.dataset.label;
                    const index = ctx.dataIndex;
                    if (label === "Max Concurrent Users") {
                      return label + ": " + concurrent[index] + " users";
                    }
                    return label + ": " + ctx.formattedValue;
                  }
                }
              }
            },
            scales: {
              x: { ticks: { color: "#ccc" } },
              y: { ticks: { color: "#ccc" }, beginAtZero: true }
            }
          }
        });
      </script>
    </body>
    </html>
  `);
});

const robots = `User-agent: *
Allow: /
Disallow: /ping
Disallow: /leave
Disallow: /cleanup`;

const sitemap = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url>
  <loc>https://live.alimad.xyz/</loc>
  <changefreq>weekly</changefreq>
  <priority>1.0</priority>
</url>
</urlset>`;

app.get("/robots.txt", (req, res) => {
  res.type("text").send(robots);
});

app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").send(sitemap);
});

app.get("/robots", (req, res) => {
  res.type("text").send(robots);
});

app.get("/sitemap", (req, res) => {
  res.type("application/xml").send(sitemap);
});

app.listen(PORT, () => {
  console.log(`Live API running at http://localhost:${PORT}`);
});
