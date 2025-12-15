const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function reset() {
  if (process.env.CONFIRM_RESET !== "YES") {
    console.log("Refusing to reset database.");
    console.log('Set CONFIRM_RESET=YES then run again.');
    process.exit(1);
  }

  console.log("RESETTING DATABASE TABLES...");

  const dropSql = `
    DROP TABLE IF EXISTS account_devices CASCADE;
    DROP TABLE IF EXISTS account_achievements CASCADE;
    DROP TABLE IF EXISTS account_reports CASCADE;
    DROP TABLE IF EXISTS cloud_logs CASCADE;
    DROP TABLE IF EXISTS cloud_saves CASCADE;
  `;

  try {
    await pool.query(dropSql);
    console.log("Dropped tables successfully.");

    console.log("Pls run: node init-db.js to recreate tables");
  } catch (err) {
    console.error("Reset DB error:", err);
  } finally {
    await pool.end();
  }
}

reset();
