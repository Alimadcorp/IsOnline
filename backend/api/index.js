import express from "express";
import { db } from "../lib/firebase";
import { checkRate } from "../lib/rate_limit";

const app = express();

const TIMEOUT = 2 * 60 * 1000;

app.get("/ping", async (req, res) => {
  const { app: appId, myId } = req.query;
  if (!appId || !myId) return res.status(400).send("Missing app or myId");
  const ref = db.ref(`online_status/${appId}/${myId}`);
  await ref.set(Date.now());
  const snap = await db.ref(`online_status/${appId}`).once("value");
  const data = snap.val() || {};
  const now = Date.now();
  let count = 0;
  for (const key in data) {
    if (now - data[key] < TIMEOUT) count++;
    else db.ref(`online_status/${appId}/${key}`).remove(); // cleanup
  }
  res.setHeader("Content-Type", "text/plain");
  res.send(count.toString());
});

app.get("/leave", async (req, res) => {
  const { app: appId, myId } = req.query;
  if (!appId || !myId) return res.status(400).send("Missing app or myId");
  await db.ref(`online_status/${appId}/${myId}`).remove();
  res.setHeader("Content-Type", "text/plain");
  res.send("0");
});

app.get("/get", async (req, res) => {
  const { app: appId } = req.query;
  if (!appId) return res.status(400).send("Missing app");
  const snap = await db.ref(`online_status/${appId}`).once("value");
  const data = snap.val() || {};
  const now = Date.now();
  let count = 0;
  for (const key in data) {
    if (now - data[key] < TIMEOUT) count++;
  }
  res.setHeader("Content-Type", "text/plain");
  res.send(count.toString());
});

app.get("/app", (req, res) => {
  const { myId } = req.query;
  if (!myId) return res.status(400).send("Missing myId");
  res.setHeader("Content-Type", "text/plain");
  res.send(myId.toString());
});

app.get("/app/:id", (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.send(req.params.id);
});

app.use((req, res, next) => {
  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.socket.remoteAddress || "unknown";
  if (!checkRate(ip)) return res.status(429).send("Rate limit exceeded");
  next();
});

export default app;