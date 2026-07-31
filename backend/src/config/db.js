import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });
dotenv.config();

export const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "retela_db",
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true
});

export async function query(sql, params = {}) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (err) {
    console.error("======================================");
    console.error("DATABASE ERROR");
    console.error("======================================");
    console.error("SQL:");
    console.error(sql);
    console.error("--------------------------------------");
    console.error("PARAMETERS:");
    console.error(JSON.stringify(params, null, 2));
    console.error("--------------------------------------");
    console.error("MYSQL ERROR:");
    console.error("Code:", err.code);
    console.error("Errno:", err.errno);
    console.error("SQL State:", err.sqlState);
    console.error("Message:", err.sqlMessage);
    console.error(err);
    console.error("======================================");
    throw err;
  }
}

export async function transaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const run = async (sql, params = {}) => {
      const [rows] = await connection.execute(sql, params);
      return rows;
    };

    const result = await callback(run, connection);

    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}