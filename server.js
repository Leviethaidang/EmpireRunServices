//server.js
const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4000;

// ===== Middleware =====
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

app.use(express.static("public"));
// ===== Kết nối PostgreSQL =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
// ===== Realtime Log Stream (SSE) =====
const logSseClients = new Set();

function broadcastLogToClients(log) {
  const data = `data: ${JSON.stringify(log)}\n\n`;
  for (const res of logSseClients) {
    try { res.write(data); } catch (_) {}
  }
}

// ====== POST /api/cloud-save/sync ======
// Body: { email, username, saveJson }
app.post("/api/cloud-save/sync", async (req, res) => {
  const { email, username, saveJson } = req.body || {};

  if (!email || !username || !saveJson) {
    return res.status(400).json({
      success: false,
      message: "Missing email, username or saveJson",
    });
  }

   const normalizedEmail = normalizeEmail(email);
  
  try {
    const query = `
      INSERT INTO cloud_saves (email, username, save_json, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (email, username)
      DO UPDATE SET
        save_json = EXCLUDED.save_json,
        updated_at = NOW()
      RETURNING id, updated_at;
    `;

    const values = [normalizedEmail, username, saveJson];
    const result = await pool.query(query, values);

    const row = result.rows[0];

    return res.json({
      success: true,
      id: row.id,
      email: normalizedEmail,
      username,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    logDbError("sync", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while syncing save",
    });
  }
});

// ====== GET /api/cloud-save/fetch?email=...&username=... ======
app.get("/api/cloud-save/fetch", async (req, res) => {
  const { email, username } = req.query;

  if (!email || !username) {
    return res.status(400).json({
      success: false,
      message: "Missing email or username",
    });
  }
  const normalizedEmail = normalizeEmail(email);
  try {
    const query = `
      SELECT email, username, save_json, updated_at
      FROM cloud_saves
      WHERE email = $1 AND username = $2
      LIMIT 1;
    `;
    const values = [normalizedEmail, username];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Save not found",
      });
    }

    const row = result.rows[0];

    return res.json({
      success: true,
      email: row.email,
      username: row.username,
      saveJson: row.save_json,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    logDbError("fetch", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching save",
    });
  }
});
// ====== GET /api/cloud-save/list-by-email?email=... ======
app.get("/api/cloud-save/list-by-email", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Missing email",
    });
  }
  const normalizedEmail = normalizeEmail(email);
  try {
    const query = `
      SELECT username, updated_at
      FROM cloud_saves
      WHERE email = $1
      ORDER BY updated_at DESC;
    `;

    const values = [normalizedEmail];
    const result = await pool.query(query, values);

    const entries = result.rows.map((row) => ({
      username: row.username,
      updatedAt: row.updated_at,
    }));

    return res.json({
      success: true,
      email: normalizedEmail,
      entries,
    });
  } catch (err) {
    logDbError("list-by-email", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while listing saves",
    });
  }
});
// ====== POST /api/cloud-log/add ======
app.post("/api/cloud-log/add", async (req, res) => {
  const { email, username, deviceId, content } = req.body || {};

  if (!email || !username || !deviceId || !content) {
    return res.status(400).json({
      success: false,
      message: "Missing email, username, deviceId or content",
    });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const query = `
      INSERT INTO cloud_logs (email, username, device_id, content)
      VALUES ($1, $2, $3, $4)
      RETURNING id, created_at;
    `;

    const values = [normalizedEmail, username, deviceId, content];

    const result = await pool.query(query, values);
    const row = result.rows[0];

    const logItem = {
      id: row.id,
      email: normalizedEmail,
      username,
      deviceId,
      content,
      createdAt: row.created_at,
    };

    broadcastLogToClients(logItem);

    return res.json({
      success: true,
      id: row.id,
      createdAt: row.created_at,
    });
  } catch (err) {
    logDbError("cloud-log/add", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while adding log",
    });
  }
});
// GET logs with pagination
// /api/admin/logs?limit=20
// /api/admin/logs?limit=20&beforeId=1234  -> lấy các log cũ hơn id 1234
app.get("/api/admin/logs", async (req, res) => {
  const { limit, beforeId } = req.query;

  const safeLimit = Math.min(Math.max(parseInt(limit || "20", 10), 1), 200);
  const before = beforeId ? parseInt(beforeId, 10) : null;

  try {
    let q = `
      SELECT id, email, username, device_id, content, created_at
      FROM cloud_logs
    `;
    const params = [];

    if (Number.isInteger(before)) {
      params.push(before);
      q += ` WHERE id < $${params.length} `;
    }

    params.push(safeLimit);
    q += `
      ORDER BY id DESC
      LIMIT $${params.length};
    `;

    const r = await pool.query(q, params);

    const logs = r.rows.map(x => ({
      id: x.id,
      email: x.email,
      username: x.username,
      deviceId: x.device_id,
      content: x.content,
      createdAt: x.created_at,
    }));

    return res.json({ success: true, logs });
  } catch (err) {
    logDbError("admin/logs", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while listing logs",
    });
  }
});
//thống kê
// ===== POST /api/report/win =====
app.post("/api/report/win", async (req, res) => {
  const { email, username } = req.body || {};
  if (!email || !username) {
    return res.status(400).json({ success: false, message: "Missing email or username" });
  }

  const normalizedEmail = normalizeEmail(email);
  const client = await pool.connect();
  const deviceId = req.body.deviceId || req.body.device_id || "";
  await upsertAccountDevice(email, username, deviceId);

  try {
    await client.query("BEGIN");

    await ensureAccountReportRow(client, normalizedEmail, username);

    const q = `
      UPDATE account_reports
      SET
        wins_total = wins_total + 1,
        has_won = TRUE,
        first_win_at = COALESCE(first_win_at, NOW()),
        updated_at = NOW()
      WHERE email = $1 AND username = $2
      RETURNING wins_total, has_won, first_win_at;
    `;
    const r = await client.query(q, [normalizedEmail, username]);

    await client.query("COMMIT");
    return res.json({ success: true, report: r.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    logDbError("report/win", err);
    return res.status(500).json({ success: false, message: "Internal server error while reporting win" });
  } finally {
    client.release();
  }
});

// ===== POST /api/report/lose =====
app.post("/api/report/lose", async (req, res) => {
  const { email, username } = req.body || {};
  if (!email || !username) {
    return res.status(400).json({ success: false, message: "Missing email or username" });
  }

  const normalizedEmail = normalizeEmail(email);
  const client = await pool.connect();
  const deviceId = req.body.deviceId || req.body.device_id || "";
  await upsertAccountDevice(email, username, deviceId);

  try {
    await client.query("BEGIN");

    await ensureAccountReportRow(client, normalizedEmail, username);

    const q = `
      UPDATE account_reports
      SET
        losses_total = losses_total + 1,
        updated_at = NOW()
      WHERE email = $1 AND username = $2
      RETURNING losses_total;
    `;
    const r = await client.query(q, [normalizedEmail, username]);

    await client.query("COMMIT");
    return res.json({ success: true, report: r.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    logDbError("report/lose", err);
    return res.status(500).json({ success: false, message: "Internal server error while reporting lose" });
  } finally {
    client.release();
  }
});

// ===== POST /api/report/achievement =====
app.post("/api/report/achievement", async (req, res) => {
  const { email, username, achievementKey } = req.body || {};
  if (!email || !username || !achievementKey) {
    return res.status(400).json({ success: false, message: "Missing email, username, or achievementKey" });
  }

  const normalizedEmail = normalizeEmail(email);
  const key = String(achievementKey).trim();
  const deviceId = req.body.deviceId || req.body.device_id || "";
  await upsertAccountDevice(email, username, deviceId);

  if (!key) {
    return res.status(400).json({ success: false, message: "achievementKey is empty" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await ensureAccountReportRow(client, normalizedEmail, username);

    // insert dedupe
    const ins = `
      INSERT INTO account_achievements (email, username, achievement_key)
      VALUES ($1, $2, $3)
      ON CONFLICT (email, username, achievement_key) DO NOTHING
      RETURNING id;
    `;
    const insR = await client.query(ins, [normalizedEmail, username, key]);

    let added = false;

    if (insR.rows.length > 0) {
      added = true;
      await client.query(
        `
        UPDATE account_reports
        SET
          achievements_count = achievements_count + 1,
          updated_at = NOW()
        WHERE email = $1 AND username = $2;
        `,
        [normalizedEmail, username]
      );
    }

    await client.query("COMMIT");
    return res.json({ success: true, added, achievementKey: key });
  } catch (err) {
    await client.query("ROLLBACK");
    logDbError("report/achievement", err);
    return res.status(500).json({ success: false, message: "Internal server error while reporting achievement" });
  } finally {
    client.release();
  }
});
// ===== Report: register =====
app.post("/api/report/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const username = String(req.body.username || "").trim();
    const deviceId = String(req.body.deviceId || req.body.device_id || "").trim();

    if (!email || !username) {
      return res.status(400).json({ success: false, error: "missing_email_or_username" });
    }

    await pool.query(
      `INSERT INTO account_reports (email, username)
       VALUES ($1, $2)
       ON CONFLICT (email, username) DO NOTHING;`,
      [email, username]
    );

    await upsertAccountDevice(email, username, deviceId);

    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/report/register error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});

//===Phần dành cho admin=====
// ====== ADMIN APIs ======
// Lấy danh sách email
app.get("/api/admin/emails", async (req, res) => {
  try {
    const query = `
      SELECT 
        email,
        COUNT(*) AS save_count,
        MAX(updated_at) AS latest_updated_at
      FROM cloud_saves
      GROUP BY email
      ORDER BY email ASC;
    `;

    const result = await pool.query(query);

    const emails = result.rows.map((row) => ({
      email: row.email,
      saveCount: Number(row.save_count),
      latestUpdatedAt: row.latest_updated_at,
    }));

    return res.json({
      success: true,
      emails,
    });
  } catch (err) {
    logDbError("admin/emails", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while listing emails",
    });
  }
});

// Lấy danh sách sav theo email
// GET /api/admin/saves?email=...
app.get("/api/admin/saves", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Missing email",
    });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const query = `
      SELECT username, updated_at
      FROM cloud_saves
      WHERE email = $1
      ORDER BY updated_at DESC;
    `;
    const values = [normalizedEmail];
    const result = await pool.query(query, values);

    const saves = result.rows.map((row) => ({
      username: row.username,
      updatedAt: row.updated_at,
    }));

    return res.json({
      success: true,
      email: normalizedEmail,
      saves,
    });
  } catch (err) {
    logDbError("admin/saves", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while listing saves",
    });
  }
});

// Xoá toàn bộ save của 1 email
// DELETE /api/admin/email/:email
app.delete("/api/admin/email/:email", async (req, res) => {
  const rawEmail = req.params.email;
  if (!rawEmail) {
    return res.status(400).json({
      success: false,
      message: "Missing email",
    });
  }

  const normalizedEmail = normalizeEmail(rawEmail);

  try {
    const query = `
      DELETE FROM cloud_saves
      WHERE email = $1;
    `;
    const values = [normalizedEmail];
    const result = await pool.query(query, values);

    return res.json({
      success: true,
      email: normalizedEmail,
      deletedCount: result.rowCount,
    });
  } catch (err) {
    logDbError("admin/delete-email", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while deleting email saves",
    });
  }
});

// Xoá 1 save cụ thể
// DELETE /api/admin/save?email=...&username=...
app.delete("/api/admin/save", async (req, res) => {
  const { email, username } = req.query;

  if (!email || !username) {
    return res.status(400).json({
      success: false,
      message: "Missing email or username",
    });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const query = `
      DELETE FROM cloud_saves
      WHERE email = $1 AND username = $2;
    `;
    const values = [normalizedEmail, username];
    const result = await pool.query(query, values);

    return res.json({
      success: true,
      email: normalizedEmail,
      username,
      deletedCount: result.rowCount,
    });
  } catch (err) {
    logDbError("admin/delete-save", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while deleting save",
    });
  }
});
// Realtime stream logs (SSE)
app.get("/api/admin/logs/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  res.write(`data: ${JSON.stringify({ type: "hello", t: Date.now() })}\n\n`);

  logSseClients.add(res);

  req.on("close", () => {
    logSseClients.delete(res);
  });
});
// ===== Admin Reports APIs =====
app.get("/api/admin/reports/summary", async (req, res) => {
  try {
    const q = `
      SELECT
        COUNT(*)::int AS players_total,
        COALESCE(SUM(wins_total), 0)::int AS wins_total,
        COALESCE(SUM(losses_total), 0)::int AS losses_total,
        COALESCE(AVG(achievements_count), 0)::float AS achievements_avg,
        COALESCE(SUM(CASE WHEN has_won THEN 1 ELSE 0 END), 0)::int AS players_won
      FROM account_reports;
    `;

    const result = await pool.query(q);
    const row = result.rows[0] || {};

    const playersTotal = row.players_total || 0;
    const playersWon = row.players_won || 0;

    const completionRate = playersTotal > 0 ? (playersWon / playersTotal) : 0;

    return res.json({
      success: true,
      summary: {
        playersTotal,
        playersWon,
        completionRate, // 0..1
        winsTotal: row.wins_total || 0,
        lossesTotal: row.losses_total || 0,
        achievementsAvg: row.achievements_avg || 0,
      },
    });
  } catch (err) {
    console.error("GET /api/admin/reports/summary error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});

// Player list
app.get("/api/admin/reports/players", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 200));
    const offset = Math.max(0, parseInt(req.query.offset || "0", 10));
    const qStr = String(req.query.q || "").trim();

    const query = `
      SELECT
        ar.email,
        ar.username,
        ar.wins_total,
        ar.losses_total,
        ar.achievements_count,
        COALESCE(ad.device_count, 0) AS device_count
      FROM account_reports ar
      LEFT JOIN (
        SELECT email, username, COUNT(*) AS device_count
        FROM account_devices
        GROUP BY email, username
      ) ad
        ON ad.email = ar.email AND ad.username = ar.username
      WHERE
        ($1 = '' OR ar.email ILIKE '%' || $1 || '%' OR ar.username ILIKE '%' || $1 || '%')
      ORDER BY ar.updated_at DESC
      LIMIT $2
      OFFSET $3;
    `;

    const values = [qStr, limit, offset];
    const result = await pool.query(query, values);

    return res.json({ success: true, players: result.rows });
  } catch (err) {
    console.error("GET /api/admin/reports/players error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});


// Detail
app.get("/api/admin/reports/detail", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    const username = String(req.query.username || "").trim();

    if (!email || !username) {
      return res.status(400).json({ success: false, error: "missing_email_or_username" });
    }

    // 1) lấy report
    const r1 = await pool.query(
      `SELECT *
       FROM account_reports
       WHERE email = $1 AND username = $2
       LIMIT 1;`,
      [email, username]
    );

    const row = r1.rows[0];
    if (!row) return res.json({ success: true, report: null });

    // 2) lấy danh sách device
    const devR = await pool.query(
      `SELECT device_id
       FROM account_devices
       WHERE email = $1 AND username = $2
       ORDER BY created_at ASC;`,
      [row.email, row.username]
    );

    const deviceIds = devR.rows.map(x => x.device_id);
    
    // 3) lấy danh sách achievements
    const achR = await pool.query(
      `SELECT achievement_key
      FROM account_achievements
      WHERE email = $1 AND username = $2
      ORDER BY unlocked_at ASC;`,
      [row.email, row.username]
    );
    const achKeys = achR.rows.map(x => x.achievement_key);

    row.device_ids = deviceIds;
    row.device_count = deviceIds.length;
    row.achievement_ids = achKeys;

    return res.json({ success: true, report: row });
  } catch (err) {
    console.error("GET /api/admin/reports/detail error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});




// ===== Helper functions =====
function normalizeEmail(email) {
  if (!email) return "";
  return email.trim().toLowerCase();
}
// Helper log lỗi DB
function logDbError(context, err) {
  console.error(`[DB ERROR] ${context}:`, err);
}

// ===== Khởi động server =====
app.listen(PORT, () => {
  console.log(`EmpireRunServices running at http://localhost:${PORT}`);
});
// ===== Route =====
app.get("/status", (req, res) => {
  res.json({ ok: true, service: "EmpireRunServices" });
});

// Home (Admin Manager)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Logs page (UI)
app.get("/reports", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "reports.html"));
});

// ===== Hide .html routes =====
app.get("/admin.html", (req, res) => res.redirect("/"));
app.get("/reports.html", (req, res) => res.redirect("/reports"));

// đảm bảo luôn có row trong account_reports
async function ensureAccountReportRow(client, email, username) {
  const q = `
    INSERT INTO account_reports (email, username)
    VALUES ($1, $2)
    ON CONFLICT (email, username) DO NOTHING;
  `;
  await client.query(q, [email, username]);
}
// thêm thiết bị vào account_devices
async function upsertAccountDevice(email, username, deviceId) {
  const e = String(email || "").trim().toLowerCase();
  const u = String(username || "").trim();
  const d = String(deviceId || "").trim();

  if (!e || !u || !d) return;

  // dedupe nhờ UNIQUE(email, username, device_id)
  await pool.query(
    `INSERT INTO account_devices (email, username, device_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (email, username, device_id) DO NOTHING;`,
    [e, u, d]
  );
}

//test ket noi db
app.get("/db-status", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW() AS now;");
    res.json({ ok: true, now: r.rows[0].now });
  } catch (err) {
    logDbError("db-status", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});