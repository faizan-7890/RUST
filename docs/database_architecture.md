# Firebase SQL & Cloud API Architecture (`db` Branch)

This document specifies the optional cloud persistence backend for **RustWasm Studio**, combining **Firebase Authentication**, **Firebase Cloud Storage**, **Cloud SQL (PostgreSQL)**, **Firebase Data Connect**, and **Cloud Functions for Firebase (Express REST API)**.

> [!NOTE]
> The core Rust + WebAssembly image processing studio (`www/`) remains 100% client-side and works without any backend. This architecture adds optional cloud persistence for projects, painted masks, `.cube` 3D LUTs, presets, and history snapshots.

---

## 1. High-Level Topology

```mermaid
flowchart TD
    Client["🌐 RustWasm Studio UI (www/)<br/>Wasm Worker + www/api/client.js"]
    Auth["🔐 Firebase Authentication<br/>(JWT ID Tokens)"]
    Storage["🪣 Firebase Cloud Storage<br/>(Original Images, Masks, .cube LUTs)"]
    Hosting["🚀 Firebase Hosting<br/>(/api/** rewrite → Cloud Functions)"]
    API["⚡ Cloud Functions (Node 20 / Express)<br/>functions/src/index.js"]
    DataConnect["🔌 Firebase Data Connect<br/>dataconnect/schema/schema.gql"]
    SQL[("🐘 Cloud SQL (PostgreSQL 15+)<br/>db/migrations/001_init.sql")]

    Client -->|"Sign In / ID Token"| Auth
    Client -->|"Binary Upload/Download<br/>(storage.rules enforced)"| Storage
    Client -->|"REST JSON + Bearer Token"| Hosting
    Hosting --> API
    Client -.->|"Optional Typed GraphQL SDK"| DataConnect
    API -->|"Verify ID Token"| Auth
    API -->|"Parameterized SQL (pg Pool)"| SQL
    DataConnect --> SQL
```

---

## 2. PostgreSQL Schema (`db/migrations/001_init.sql`)

```mermaid
erDiagram
    users ||--o{ projects : owns
    users ||--o{ presets : owns
    users ||--o{ custom_luts : uploads
    custom_luts ||--o{ projects : "referenced by active_lut_id"
    projects ||--o{ project_snapshots : records

    users {
        text uid PK
        text email
        text display_name
        timestamptz created_at
        timestamptz updated_at
    }

    custom_luts {
        uuid id PK
        text owner_uid FK
        text title
        smallint lut_size
        text storage_path
        integer file_bytes
        boolean is_public
        timestamptz created_at
    }

    projects {
        uuid id PK
        text owner_uid FK
        text name
        integer width
        integer height
        text source_storage_path
        text mask_storage_path
        boolean mask_enabled
        uuid active_lut_id FK
        jsonb filter_state
        jsonb tone_curves
        boolean is_public
        timestamptz created_at
        timestamptz updated_at
    }

    project_snapshots {
        uuid id PK
        uuid project_id FK
        integer cursor_index
        text label
        jsonb filter_state
        jsonb tone_curves
        text mask_storage_path
        timestamptz created_at
    }

    presets {
        uuid id PK
        text owner_uid FK
        text name
        text description
        jsonb filter_state
        jsonb tone_curves
        boolean is_public
        timestamptz created_at
        timestamptz updated_at
    }
```

### Design Rationale
- **Binary payloads stay out of SQL**: Large RGBA source images, alpha masks, and `.cube` LUT files live in **Firebase Cloud Storage** under `users/{uid}/...` protected by `storage.rules`. PostgreSQL stores only validated metadata and `storage_path` references.
- **`JSONB` for Filter & Curve State**: `filter_state` stores all studio sliders (including Brightness, Contrast, Saturation, Lens Optics `lensK1`/`caAngle`, and OKLCH `oklchLightness`/`oklchChroma`/`oklchHueRotation`/selective band parameters), while `tone_curves` stores the `master`/`r`/`g`/`b` spline anchor arrays.
- **Dual SQL Access Path**:
  - **REST API** (`functions/`): Express + `pg` + `zod` for custom validation, `/health` checks, and REST clients (`www/api/client.js`).
  - **Firebase Data Connect** (`dataconnect/`): Type-safe GraphQL schema and `@auth(level: USER | PUBLIC)` queries/mutations over the exact same PostgreSQL tables.

---

## 3. REST API Endpoints (`functions/src/`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | Verify API & PostgreSQL connectivity |
| `GET` | `/v1/projects` | Bearer Token | List authenticated user's projects |
| `GET` | `/v1/projects/:id` | Bearer Token | Fetch an owned or public project |
| `POST` | `/v1/projects` | Bearer Token | Create project (enforces `users/{uid}/projects/` path ownership) |
| `PATCH` | `/v1/projects/:id` | Bearer Token | Save slider `filterState`, `toneCurves`, mask, or title |
| `DELETE` | `/v1/projects/:id` | Bearer Token | Delete owned project (cascades snapshots) |
| `GET` | `/v1/projects/:id/snapshots` | Bearer Token | List cloud history snapshots |
| `POST` | `/v1/projects/:id/snapshots` | Bearer Token | Push a cloud snapshot mirroring Wasm `HistoryEntry` |
| `GET` | `/v1/presets/public` | Public | Browse shared presets |
| `GET` | `/v1/presets` | Bearer Token | List user's saved presets |
| `POST` | `/v1/presets` | Bearer Token | Save current filter/OKLCH/curve look as preset |
| `DELETE` | `/v1/presets/:id` | Bearer Token | Delete owned preset |
| `GET` | `/v1/luts` | Bearer Token | List owned and public `.cube` LUT records |
| `POST` | `/v1/luts` | Bearer Token | Register `.cube` LUT uploaded to `users/{uid}/luts/` |
| `DELETE` | `/v1/luts/:id` | Bearer Token | Delete owned LUT record |

---

## 4. Setup & Local Emulator Workflow

1. **Install Firebase CLI & dependencies**:
   ```bash
   npm install -g firebase-tools
   cd functions && npm install
   ```
2. **Configure local environment**:
   - Copy `.firebaserc.example` → `.firebaserc` and set your Firebase project ID.
   - Copy `.env.example` → `functions/.env` and set `DATABASE_URL` pointing to local Postgres or Cloud SQL Auth Proxy.
   - Apply the initial migration:
     ```bash
     psql "$DATABASE_URL" -f db/migrations/001_init.sql
     ```
3. **Run Firebase Emulators**:
   ```bash
   firebase emulators:start
   ```
   Emulators run Auth (`:9099`), Functions (`:5001`), Hosting (`:5000`), Storage (`:9199`), Data Connect (`:9399`), and Emulator UI (`:4000`).
