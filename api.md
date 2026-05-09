# API Requirement: `/api/editor`

Dokumen ini mendefinisikan kebutuhan API untuk fitur **Publish** dari `editor.slice-code.com` ke backend `slice-code.com` (PHP).

## Pembaruan implementasi (sinkron backend)

- **Access token (cookie `editor_access_token`)**: masa berlaku **24 jam** (`Max-Age=86400`). Refresh token tetap long-lived (mis. ~30 hari).
- **Slug publish**: unik per **`(user_id, published_slug)`** — dua user berbeda boleh memakai **slug teks yang sama**. Referensi publik = **`author_ref` (`usr_<id>`) + slug**, bukan slug saja.
- **URL publik** (`published_url`): `{SITE_URL}/editor/usr_{user_id}/{slug}` (contoh `https://slice-code.com/editor/usr_12/todo-app`).
- **Publish ulang / replace**: jika **user yang sama** publish project lain dengan slug yang sudah dipakai project lain yang masih published, project lama **otomatis di-unpublish** (replace); respons bisa menyertakan **`replaced_project_id`**. Tidak ada **409** antar-user untuk slug sama.
- **Cek slug sebelum publish**: `GET /api/editor/projects/publish-slug-check?slug=...&except_project_id=prj_x` — untuk akurasi saat mengedit project yang sedang dibuka, kirim **`except_project_id`** agar project itu tidak dianggap “yang akan diganti”.
- **Unpublish**: selain `published_url` dan `published_at`, field **`published_slug`** di basis data juga dikosongkan agar state konsisten.
- **Store**: detail publik memakai **`GET /api/editor/store/{author_ref}/{slug}`** (`author_ref` = `usr_123` atau angka `123`). Di tiap item ada **`author_ref`** selain **`author`**.
- **Store satu segmen (legacy)**: **`GET /api/editor/store/{slug}`** — jika tidak ada ambigu (hanya satu project published dengan slug itu). Jika beberapa creator pakai slug sama → **409** `AMBIGUOUS_SLUG` + daftar kandidat; gunakan URL dua segmen. Entry bootstrap juga menangani path ini jika route Router tertinggal deploy.
- **Thumbnail publik**: gambar disimpan di DB (`thumbnail_data`); URL **`thumbnail_url`** = `{SITE_URL}/api/editor/public/thumbnails/prj_{project_id}` (bukan CDN placeholder).
- **`author` di store**: **`author.name`** = kolom **`users.name`** (nama tampilan); **`author.username`** = kolom **`users.user`** (username login).
- **Publish respons**: menyertakan **`name`**, **`description`** (dari `editor_projects`), **`slug`** — mengikuti data DB saat publish (deskripsi diubah lewat `PUT /projects/{id}`, bukan body publish).

## Tujuan

- Menyimpan project editor ke server (bukan hanya IndexedDB lokal).
- Memungkinkan user melanjutkan project dari device/browser lain.
- Menyediakan mekanisme publish project sehingga bisa diakses publik.

## Ruang Lingkup Fase Awal

- Namespace endpoint: `/api/editor`
- Auth berbasis JWT yang disimpan di cookie `HttpOnly` dari domain utama `slice-code.com`.
- Data utama:
  - `project` (metadata project)
  - `files` (daftar file source code)
  - `publish` (status publish + URL publik)

---

## 1) Endpoint Inti yang Wajib

### 1.0 Auth Endpoint (Wajib untuk Publish)

> Login memakai JWT, tetapi token **tidak** disimpan di `localStorage`/`sessionStorage`.
> Server menyimpan JWT ke cookie agar lebih aman.

#### `POST /api/editor/auth/login`
Login user dan set cookie token.

**Request body**
```json
{
  "email": "user@mail.com",
  "password": "secret"
}
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "usr_001",
      "name": "Slice User",
      "email": "user@mail.com"
    }
  }
}
```

**Set-Cookie (contoh)**
- `editor_access_token=<jwt>; HttpOnly; Secure; SameSite=None; Path=/; Domain=.slice-code.com; Max-Age=86400` (24 jam)
- `editor_refresh_token=<jwt>; HttpOnly; Secure; SameSite=None; Path=/api/editor/auth; Domain=.slice-code.com; Max-Age=2592000`

#### `POST /api/editor/auth/refresh`
Perbarui access token menggunakan refresh token cookie.

**Response 200**
```json
{
  "success": true,
  "message": "Token refreshed"
}
```

#### `POST /api/editor/auth/logout`
Hapus cookie access/refresh token.

**Response 200**
```json
{
  "success": true,
  "message": "Logged out"
}
```

#### `GET /api/editor/auth/me`
Validasi sesi login untuk frontend editor.

**Response 200**
```json
{
  "success": true,
  "data": {
    "id": "usr_001",
    "name": "Slice User",
    "email": "user@mail.com"
  }
}
```

#### `POST /api/editor/auth/register`
Daftar akun baru untuk editor, sekaligus login (set cookie JWT).

**Request body**
```json
{
  "name": "Slice User",
  "email": "user@mail.com",
  "password": "secret123",
  "password_confirmation": "secret123"
}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "usr_001",
      "name": "Slice User",
      "email": "user@mail.com"
    }
  },
  "message": "Register success"
}
```

### 1.1 `POST /api/editor/projects`
Membuat project baru di server.

**Request body**
```json
{
  "name": "My Project",
  "description": "optional",
  "template": "default"
}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "project_id": "prj_abc123",
    "name": "My Project",
    "created_at": "2026-05-09T07:00:00Z"
  }
}
```

---

### 1.2 `GET /api/editor/projects`
Mengambil daftar project milik user login.

**Query opsional**
- `page`, `limit`, `search`, `sort`

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "project_id": "prj_abc123",
      "name": "My Project",
      "updated_at": "2026-05-09T08:00:00Z",
      "is_published": false
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

---

### 1.3 `GET /api/editor/projects/{project_id}`
Mengambil detail 1 project + seluruh file.

**Response 200**
```json
{
  "success": true,
  "data": {
    "project_id": "prj_abc123",
    "name": "My Project",
    "description": "",
    "files": [
      {
        "name": "main.js",
        "content": "console.log('hello')",
        "updated_at": "2026-05-09T08:01:00Z"
      }
    ],
    "is_published": false,
    "published_url": null
  }
}
```

---

### 1.4 `PUT /api/editor/projects/{project_id}`
Update metadata project (rename/deskripsi).

**Request body**
```json
{
  "name": "My Project v2",
  "description": "updated desc"
}
```

---

### 1.5 `DELETE /api/editor/projects/{project_id}`
Hapus project dan seluruh file.

**Response 200**
```json
{
  "success": true,
  "message": "Project deleted"
}
```

---

### 1.6 `PUT /api/editor/projects/{project_id}/files`
Simpan semua file project sekaligus (sinkron dari editor).

> Endpoint ini paling penting untuk tombol Save/Auto Save.

**Request body**
```json
{
  "files": [
    {
      "name": "main.js",
      "content": "import './utils.js';"
    },
    {
      "name": "utils.js",
      "content": "export const x = 1;"
    }
  ],
  "client_updated_at": "2026-05-09T08:10:00Z"
}
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "project_id": "prj_abc123",
    "saved_files": 2,
    "updated_at": "2026-05-09T08:10:02Z"
  }
}
```

---

### 1.7 `POST /api/editor/projects/{project_id}/publish`
Publish project ke URL publik. Endpoint ini juga dipakai untuk **memperbarui** publish (thumbnail, slug, dll.) pada project yang sudah pernah publish.

**Perilaku `published_at`**
- **Pertama kali publish**, atau **ganti `slug`**: `published_at` = waktu server saat request.
- **Sudah publish dan `slug` sama dengan sebelumnya**: metadata/thumbnail diperbarui; **`published_at` tidak di-reset** (tetap waktu publish pertama).

> Saat publish, UI mengirim screenshot dari preview iframe sebagai thumbnail.

**Request body**
```json
{
  "visibility": "public",
  "slug": "my-project",
  "thumbnail": {
    "mime_type": "image/jpeg",
    "data_base64": "/9j/4AAQSkZJRgABAQAAAQABAAD...",
    "width": 1280,
    "height": 720
  }
}
```

Keterangan `thumbnail`:
- `mime_type`: `image/jpeg` atau `image/png`
- `data_base64`: isi base64 **tanpa** prefix `data:image/...;base64,`
- `width`, `height`: resolusi screenshot sumber dari UI

**Response 200** — **`name`**, **`description`**, **`slug`** diisi dari baris **`editor_projects`** (deskripsi tidak di-set lewat body publish; ubah dulu via **`PUT /api/editor/projects/{project_id}`**).
```json
{
  "success": true,
  "data": {
    "project_id": "prj_abc123",
    "name": "My Project",
    "description": "Deskripsi dari metadata project",
    "slug": "my-project",
    "is_published": true,
    "author_ref": "usr_001",
    "published_url": "https://slice-code.com/editor/usr_001/my-project",
    "thumbnail_url": "https://slice-code.com/api/editor/public/thumbnails/prj_abc123",
    "published_at": "2026-05-09T08:15:00Z",
    "replaced_project_id": null
  }
}
```

- **`thumbnail_url`**: `null` jika tidak ada thumbnail; jika ada gambar di payload → URL **`GET /api/editor/public/thumbnails/prj_{id}`** (tanpa auth).
- **`replaced_project_id`**: terisi `prj_…` jika publish ini menggantikan publish lain milik **user yang sama** dengan slug yang sama.

#### `GET /api/editor/projects/publish-slug-check`
(Bukan Wajib fase awal, tetapi disediakan untuk UI konfirmasi replace.)

**Query**
- `slug` (wajib)
- `except_project_id` (opsional): `prj_…` project yang sedang diedit — agar slug yang sudah dipakai project itu tidak dilaporkan sebagai “akan mengganti”.

**Response 200**
```json
{
  "success": true,
  "data": {
    "slug": "my-project",
    "would_replace_project_id": "prj_xyz"
  }
}
```
`would_replace_project_id` = `null` jika tidak ada project published lain milik user dengan slug itu (atau setelah mengabaikan `except_project_id`).

---

### 1.8 `POST /api/editor/projects/{project_id}/unpublish`
Menonaktifkan akses publik project. Di sisi server, **`is_published`**, **`published_slug`**, **`published_url`**, dan **`published_at`** direset (slug/url/timestamp tidak lagi aktif untuk store).

**Response 200**
```json
{
  "success": true,
  "data": {
    "project_id": "prj_abc123",
    "is_published": false,
    "published_url": null
  }
}
```

---

### 1.9 `GET /api/editor/store`
Ambil daftar project yang sudah publish untuk halaman Store (public).

**Author di response**  
- **`author.id`** = `usr_<user_id>` pemilik (`editor_projects.user_id`).  
- **`author.name`** = kolom **`users.name`** (nama tampilan).  
- **`author.username`** = kolom **`users.user`** (username login).  
Jika nama di UI tidak sesuai, periksa **`user_id`** project dan baris **`users`** yang bersangkutan.

**Query opsional**
- `search`: keyword nama project / author
- `page`: default 1
- `limit`: default 12
- `sort`: `latest` | `popular`

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "project_id": "prj_abc123",
      "name": "Todo App",
      "description": "Simple todo with el.js",
      "slug": "todo-app",
      "author_ref": "usr_001",
      "published_url": "https://slice-code.com/editor/usr_001/todo-app",
      "thumbnail_url": "https://slice-code.com/api/editor/public/thumbnails/prj_abc123",
      "author": {
        "id": "usr_001",
        "name": "Slice User",
        "username": "slice_user"
      },
      "stats": {
        "views": 120,
        "likes": 23
      },
      "published_at": "2026-05-09T08:15:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 12,
    "total": 1
  }
}
```

### 1.10 `GET /api/editor/store/{author_ref}/{slug}`
Ambil detail 1 project publish untuk halaman detail di Store. **`author_ref`** = pemilik (`usr_123` atau `123`). Bentuk respons JSON (termasuk `author`, `files`, dll.) **sama** dengan contoh di **§1.10a** di bawah.

### 1.10a `GET /api/editor/store/{slug}` (opsional / legacy)
Satu segmen setelah `store/` (tanpa `author_ref`). Hanya jika **tepat satu** project published memakai slug itu. Jika lebih dari satu → **409** `AMBIGUOUS_SLUG` + `candidates`. Untuk kanonis gunakan **§1.10**.

**Response 200**
```json
{
  "success": true,
  "data": {
    "project_id": "prj_abc123",
    "name": "Todo App",
    "description": "Simple todo with el.js",
    "slug": "todo-app",
    "author_ref": "usr_001",
    "published_url": "https://slice-code.com/editor/usr_001/todo-app",
    "thumbnail_url": "https://slice-code.com/api/editor/public/thumbnails/prj_abc123",
    "author": {
      "id": "usr_001",
      "name": "Slice User",
      "username": "slice_user"
    },
    "stats": {
      "views": 120,
      "likes": 23
    },
    "published_at": "2026-05-09T08:15:00Z",
    "files": [
      {
        "name": "main.js",
        "content": "..."
      }
    ]
  }
}
```

### 1.11 `GET /api/editor/store/me`
Ambil daftar publish milik user login (untuk dashboard creator).

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "project_id": "prj_abc123",
      "name": "Todo App",
      "slug": "todo-app",
      "author_ref": "usr_001",
      "published_url": "https://slice-code.com/editor/usr_001/todo-app",
      "thumbnail_url": "https://slice-code.com/api/editor/public/thumbnails/prj_abc123",
      "is_published": true,
      "published_at": "2026-05-09T08:15:00Z"
    }
  ]
}
```

---

## 2) Kontrak Respons Standar

Gunakan format konsisten:

```json
{
  "success": true,
  "data": {},
  "message": "optional"
}
```

Saat error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "name is required",
    "details": {
      "field": "name"
    }
  }
}
```

## 3) Kode Status HTTP

- `200` sukses umum
- `201` resource baru
- `400` validasi gagal
- `401` belum login
- `403` tidak punya akses ke project
- `404` project tidak ditemukan
- `404` kombinasi `author_ref` + slug store tidak ditemukan
- `409` email sudah terdaftar (register)
- `409` slug store legacy ambigu (`AMBIGUOUS_SLUG` — beberapa project published dengan slug sama; gunakan URL dua segmen)
- `413` payload terlalu besar
- `415` format thumbnail tidak didukung
- `429` rate limit
- `500` server error

## 4) Kebutuhan Validasi Data

- `project.name`: wajib, 1-100 karakter
- `auth.name`: wajib, 2-100 karakter (register)
- `auth.email`: wajib, format email valid, unik (register)
- `auth.password`: wajib, minimal 8 karakter (register)
- `auth.password_confirmation`: wajib, harus sama dengan `password`
- `file.name`: wajib, tidak boleh path traversal (`../`)
- `file.content`: string
- Minimal harus ada `main.js` sebelum publish
- Batas file per project (misal 200 file)
- Batas ukuran total payload simpan (misal 1-2 MB per request fase awal)
- Validasi thumbnail publish:
  - maksimal ukuran decoded image (misal 2 MB)
  - hanya `image/jpeg` dan `image/png`
  - minimal dimensi (misal 320x180)
  - maksimal dimensi (misal 3840x2160)
- `search` store maksimal 100 karakter
- `limit` store maksimal 50

## 5) Kebutuhan Security

- Semua endpoint `/api/editor/*` wajib auth (kecuali endpoint public reader jika nanti dibuat).
- CORS hanya izinkan origin:
  - `https://editor.slice-code.com`
  - `https://slice-code.com`
- Wajib pakai JWT di cookie `HttpOnly` + `Secure` + `SameSite=None` (karena beda subdomain).
- Access token: di lingkungan ini **24 jam** (`86400` detik); refresh token long-lived (contoh 30 hari). (Versi awal dokumen menyebut 15 menit; disesuaikan agar sesi editor tidak terlalu sering putus.)
- Cookie domain direkomendasikan `.slice-code.com` agar bisa dipakai `slice-code.com` dan `editor.slice-code.com`.
- JWT tidak boleh diekspos ke JavaScript frontend.
- CSRF protection wajib karena auth berbasis cookie (double submit token atau CSRF header).
- Validasi ownership: user hanya boleh akses project miliknya.
- Sanitasi slug publish.

## 6) Kebutuhan Database (Minimal)

Tabel minimum:

- `editor_projects`
  - `id`, `user_id`, `name`, `description`, `is_published`, `published_slug`, `published_url`, `thumbnail_url`, `created_at`, `updated_at`
  - unik: **`(user_id, published_slug)`** (bukan `published_slug` saja)
- `editor_files`
  - `id`, `project_id`, `name`, `content`, `created_at`, `updated_at`
- (opsional) `editor_project_revisions`
  - untuk versioning/history publish
- (opsional) `editor_project_stats`
  - `project_id`, `views`, `likes`, `updated_at`

## 7) Integrasi Frontend Editor (Tahap Implementasi Berikutnya)

Alur yang akan dipakai editor:

1. User login:
   - `POST /api/editor/auth/register` (jika belum punya akun)
   - `POST /api/editor/auth/login`
   - cek sesi: `GET /api/editor/auth/me`
2. Editor buka project:
   - `GET /api/editor/projects`
   - `GET /api/editor/projects/{id}`
3. Save/Auto Save:
   - `PUT /api/editor/projects/{id}/files`
4. Publish:
   - Capture screenshot dari preview iframe
   - `POST /api/editor/projects/{id}/publish`
   - kirim `thumbnail` di payload publish
5. Store page (public):
   - `GET /api/editor/store?search=...`
   - `GET /api/editor/store/{author_ref}/{slug}`
6. Creator dashboard publish (private):
   - `GET /api/editor/store/me`
7. Jika access token expired:
   - `POST /api/editor/auth/refresh`
8. Logout:
   - `POST /api/editor/auth/logout`
9. Update status publish di UI berdasarkan `is_published` + `published_url`.

## 8) Catatan Implementasi Backend PHP

- Direkomendasikan route berbasis controller:
  - `EditorProjectController`
  - `EditorPublishController`
- Pastikan transaksi DB saat overwrite files (delete lama + insert baru) agar konsisten.
- Simpan waktu `updated_at` project tiap kali files berubah.
- Siapkan log audit minimal untuk aksi publish/unpublish.

## 9) Non-Goal Fase Ini

Belum wajib di fase awal:

- Collaboration realtime multi-user
- Diff patch antar file
- Partial file sync per line
- Asset binary upload (image, font, dll)

