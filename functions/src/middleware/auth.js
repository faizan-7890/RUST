import { getAuth } from "firebase-admin/auth";

function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Verifies a Firebase Auth ID token from the Authorization header.
 * Rejects with 401 when missing or invalid.
 */
export async function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing Bearer token" });
  }
  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      picture: decoded.picture || null,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired Firebase ID token" });
  }
}

/**
 * Attaches `req.user` if a valid Bearer token is present; otherwise continues anonymously.
 */
export async function optionalAuth(req, _res, next) {
  const token = extractBearerToken(req);
  if (!token) return next();
  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      picture: decoded.picture || null,
    };
  } catch {
    // Ignore invalid optional tokens on public endpoints
  }
  return next();
}
