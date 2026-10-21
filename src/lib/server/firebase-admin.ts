import "server-only";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APP_NAME = "prism-history";

function adminConfiguration() {
  const authProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() || authProjectId;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const useApplicationDefault = process.env.FIREBASE_ADMIN_USE_APPLICATION_DEFAULT === "true";
  // A browser session must never address another Firebase project's storage.
  if (!projectId || (authProjectId && projectId !== authProjectId)) return null;
  if (clientEmail && privateKey) return { projectId, clientEmail, privateKey, useApplicationDefault: false };
  if (!clientEmail && !privateKey && useApplicationDefault) return { projectId, useApplicationDefault: true };
  return null;
}

export function firebaseAdminConfigured(): boolean {
  return adminConfiguration() !== null;
}

export function firebaseAdminConfigurationPresent(): boolean {
  const applicationDefaultSetting = process.env.FIREBASE_ADMIN_USE_APPLICATION_DEFAULT?.trim();
  return ["FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_ADMIN_PRIVATE_KEY"]
    .some(name => Boolean(process.env[name]?.trim()))
    || Boolean(applicationDefaultSetting && applicationDefaultSetting !== "false");
}

export function historyFirestore() {
  const config = adminConfiguration();
  if (!config) throw new Error("Firebase history storage is not configured");
  const app = getApps().find(value => value.name === APP_NAME) ?? initializeApp({
    projectId: config.projectId,
    credential: config.useApplicationDefault
      ? applicationDefault()
      : cert({ projectId: config.projectId, clientEmail: config.clientEmail!, privateKey: config.privateKey! }),
  }, APP_NAME);
  return getFirestore(app);
}
