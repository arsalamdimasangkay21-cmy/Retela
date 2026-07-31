import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.join(__dirname, "..");

dotenv.config({ path: path.join(backendRoot, ".env") });
dotenv.config();

if (!process.env.PAYMONGO_SECRET_KEY && !globalThis.__RETELA_PAYMONGO_WARNING_LOGGED__) {
  globalThis.__RETELA_PAYMONGO_WARNING_LOGGED__ = true;
  console.error("PAYMONGO_SECRET_KEY is missing");
}
