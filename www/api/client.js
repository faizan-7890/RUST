/**
 * Client SDK wrapper for the Firebase Cloud Functions + Cloud SQL REST API.
 * Safe to import in standalone/GitHub Pages mode: requests only run when called
 * with a configured `baseUrl` and (for user-scoped endpoints) a Firebase ID token.
 */

export class ApiError extends Error {
  constructor(message, status, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function defaultBaseUrl() {
  try {
    return import.meta?.env?.VITE_API_BASE_URL || "/api";
  } catch {
    return "/api";
  }
}

export class StudioApiClient {
  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl] Base API URL (e.g. "/api" or Firebase emulator URL)
   * @param {() => Promise<string|null>|string|null} [options.getToken] Async Firebase ID token provider
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || defaultBaseUrl()).replace(/\/+$/, "");
    this.getToken = options.getToken || (() => null);
  }

  async _request(path, { method = "GET", body = undefined, requireAuth = true } = {}) {
    const headers = { "Accept": "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const token = await this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else if (requireAuth) {
      throw new ApiError("Firebase Auth ID token is required for this endpoint.", 401);
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return null;

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(
        data?.error || `Request failed with status ${res.status}`,
        res.status,
        data?.details || null
      );
    }
    return data;
  }

  health() {
    return this._request("/health", { requireAuth: false });
  }

  // ── Projects & Snapshots ──────────────────────────────────────────────────
  listProjects() {
    return this._request("/v1/projects");
  }

  getProject(id) {
    return this._request(`/v1/projects/${encodeURIComponent(id)}`);
  }

  createProject(payload) {
    return this._request("/v1/projects", { method: "POST", body: payload });
  }

  updateProject(id, patch) {
    return this._request(`/v1/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    });
  }

  deleteProject(id) {
    return this._request(`/v1/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  listSnapshots(projectId) {
    return this._request(`/v1/projects/${encodeURIComponent(projectId)}/snapshots`);
  }

  pushSnapshot(projectId, snapshot) {
    return this._request(`/v1/projects/${encodeURIComponent(projectId)}/snapshots`, {
      method: "POST",
      body: snapshot,
    });
  }

  // ── Presets ───────────────────────────────────────────────────────────────
  listPublicPresets() {
    return this._request("/v1/presets/public", { requireAuth: false });
  }

  listMyPresets() {
    return this._request("/v1/presets");
  }

  createPreset(payload) {
    return this._request("/v1/presets", { method: "POST", body: payload });
  }

  deletePreset(id) {
    return this._request(`/v1/presets/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  // ── Custom 3D LUTs ────────────────────────────────────────────────────────
  listLuts() {
    return this._request("/v1/luts");
  }

  registerLut(payload) {
    return this._request("/v1/luts", { method: "POST", body: payload });
  }

  deleteLut(id) {
    return this._request(`/v1/luts/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}
