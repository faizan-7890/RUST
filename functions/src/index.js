import { getApps, initializeApp } from "firebase-admin/app";
import { onRequest } from "firebase-functions/v2/https";
import app from "./app.js";

if (!getApps().length) {
  initializeApp();
}

export const api = onRequest(
  {
    region: "us-central1",
    cors: false,
    memory: "256MiB",
    timeoutSeconds: 30,
  },
  app
);
