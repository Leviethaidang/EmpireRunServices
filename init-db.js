const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function init() {
  console.log("Connecting to database...");

  const queryCloudSaves = `
    CREATE TABLE IF NOT EXISTS cloud_saves (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      save_json TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_email_username UNIQUE (email, username)
    );
  `;

  const queryCloudLogs = `
    CREATE TABLE IF NOT EXISTS cloud_logs (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      device_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `;

  // ===== reports =====
  const queryAccountReports = `
    CREATE TABLE IF NOT EXISTS account_reports (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,

      wins_total INT NOT NULL DEFAULT 0,
      losses_total INT NOT NULL DEFAULT 0,

      has_won BOOLEAN NOT NULL DEFAULT FALSE,
      first_win_at TIMESTAMP NULL,

      achievements_count INT NOT NULL DEFAULT 0,

      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

      CONSTRAINT unique_account UNIQUE (email, username)
    );
  `;
  const queryAccountAchievements = `
    CREATE TABLE IF NOT EXISTS account_achievements (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      achievement_key TEXT NOT NULL,
      unlocked_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_achievement UNIQUE (email, username, achievement_key)
    );
  `;
  const queryAccountDevices = `
    CREATE TABLE IF NOT EXISTS account_devices (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      device_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_device UNIQUE (email, username, device_id)
    );
  `;
  try {
    await pool.query(queryCloudSaves);
    console.log("Table cloud_saves created successfully!");

    await pool.query(queryCloudLogs);
    console.log("Table cloud_logs created successfully!");

    await pool.query(queryAccountReports);
    console.log("Table account_reports created successfully!");

    await pool.query(queryAccountAchievements);
    console.log("Table account_achievements created successfully!");

    await pool.query(queryAccountDevices);
    console.log("Table account_devices created successfully!");
  } catch (err) {
    console.error("Error creating table:", err);
  } finally {
    pool.end();
  }
}

init();
