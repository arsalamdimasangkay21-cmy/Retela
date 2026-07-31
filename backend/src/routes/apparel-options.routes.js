import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { requireAuth, requireApproved, requireRole } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";

const optionConfig = {
  categories: {
    table: "categories",
    label: "category",
    defaults: ["T-Shirts", "Jackets", "Caps", "Other"]
  },
  types: {
    table: "types",
    label: "type",
    defaults: ["Men", "Women", "Kids", "Vintage", "Oversized", "Streetwear", "Sportswear", "Formal", "Casual", "Unisex", "Other"]
  },
  sizes: {
    table: "sizes",
    label: "size",
    defaults: ["XS", "S", "M", "L", "XL", "XXL", "Free Size", "Other"]
  },
  conditions: {
    table: "conditions",
    label: "condition",
    defaults: ["Like New", "Excellent", "Very Good", "Good", "Fair", "Other"]
  },
  brands: {
    table: "brands",
    label: "brand",
    defaults: ["Adidas", "Nike", "Lacoste", "Essentials", "Uniqlo", "H&M", "Zara", "Bench", "Penshoppe", "Champion", "Puma", "Reebok", "Under Armour", "Jordan", "Levi's", "Ralph Lauren", "Tommy Hilfiger", "GAP", "Old Navy", "Dickies", "Carhartt", "Stussy", "Converse", "Vans", "New Balance", "Gildan", "Hanes", "Fruit of the Loom", "Blue Corner", "Regatta", "Other"]
  }
};

let optionTablesReady;

export async function ensureApparelOptionTables() {
  optionTablesReady ||= (async () => {
    for (const config of Object.values(optionConfig)) {
      await query(
        `CREATE TABLE IF NOT EXISTS \`${config.table}\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_${config.table}_name (name)
        )`
      );
      for (const name of config.defaults) {
        await query(
          `INSERT INTO \`${config.table}\` (name)
           SELECT :name
           WHERE NOT EXISTS (
             SELECT 1 FROM \`${config.table}\` WHERE LOWER(name) = LOWER(:name)
           )`,
          { name }
        );
      }
    }
  })().catch((error) => {
    optionTablesReady = undefined;
    throw error;
  });
  return optionTablesReady;
}

function createOptionRouter(kind) {
  const config = optionConfig[kind];
  const router = Router();
  const schema = z.object({ name: z.string().trim().min(1).max(120) });

  router.get("/", requireAuth, requireApproved, asyncHandler(async (req, res) => {
    await ensureApparelOptionTables();
    const rows = await query(`SELECT id, name, created_at FROM \`${config.table}\` ORDER BY name ASC`);
    res.json(rows);
  }));

  router.post("/", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
    await ensureApparelOptionTables();
    const { name } = schema.parse(req.body);
    const trimmedName = name.trim();
    const existing = await query(
      `SELECT id, name, created_at FROM \`${config.table}\` WHERE LOWER(name) = LOWER(:name) LIMIT 1`,
      { name: trimmedName }
    );
    if (existing.length) {
      throw new HttpError(409, `This ${config.label} already exists.`, {
        name: `This ${config.label} already exists.`
      });
    }
    const result = await query(`INSERT INTO \`${config.table}\` (name) VALUES (:name)`, { name: trimmedName });
    const [created] = await query(`SELECT id, name, created_at FROM \`${config.table}\` WHERE id = :id LIMIT 1`, { id: result.insertId });
    res.status(201).json(created);
  }));

  return router;
}

export const categoriesRoutes = createOptionRouter("categories");
export const typesRoutes = createOptionRouter("types");
export const sizesRoutes = createOptionRouter("sizes");
export const conditionsRoutes = createOptionRouter("conditions");
export const brandsRoutes = createOptionRouter("brands");
