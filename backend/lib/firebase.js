import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
const cred = require("./madwebrtc-firebase.json");

if (!getApps().length) {
  initializeApp({
    credential: cert(cred),
    databaseURL: "https://madwebrtc-default-rtdb.firebaseio.com",
  });
}

export const db = getDatabase();