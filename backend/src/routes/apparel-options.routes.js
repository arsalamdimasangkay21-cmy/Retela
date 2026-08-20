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
  },
  colors: {
    table: "colors",
    label: "color",
    defaults: ["Black", "White", "Gray", "Red", "Blue", "Green", "Yellow", "Brown", "Pink", "Purple", "Orange", "Other"]
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
          is_system BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_${config.table}_name (name)
        )`
      );
      await query(`ALTER TABLE \`${config.table}\` ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT FALSE AFTER name`).catch((error) => {
        if (error?.code !== "ER_DUP_FIELDNAME") throw error;
      });
      for (const name of config.defaults) {
        await query(
          `INSERT INTO \`${config.table}\` (name, is_system)
           SELECT :name, TRUE
           WHERE NOT EXISTS (
             SELECT 1 FROM \`${config.table}\` WHERE LOWER(name) = LOWER(:name)
           )`,
          { name }
        );
        await query(`UPDATE \`${config.table}\` SET is_system = TRUE WHERE LOWER(name) = LOWER(:name)`, { name });
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
    const rows = await query(
      `SELECT id, name, is_system, created_at
       FROM \`${config.table}\`
       ORDER BY CASE WHEN LOWER(name) = 'other' THEN 2 WHEN is_system = TRUE THEN 0 ELSE 1 END,
                name ASC`
    );
    res.json(rows);
  }));

  router.post("/", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
    await ensureApparelOptionTables();
    const { name } = schema.parse(req.body);
    const trimmedName = name.trim();
    const existing = await query(
      `SELECT id, name, is_system, created_at FROM \`${config.table}\` WHERE LOWER(name) = LOWER(:name) LIMIT 1`,
      { name: trimmedName }
    );
    if (existing.length) {
      throw new HttpError(409, `This ${config.label} already exists.`, {
        name: `This ${config.label} already exists.`
      });
    }
    const result = await query(`INSERT INTO \`${config.table}\` (name, is_system) VALUES (:name, FALSE)`, { name: trimmedName });
    const [created] = await query(`SELECT id, name, is_system, created_at FROM \`${config.table}\` WHERE id = :id LIMIT 1`, { id: result.insertId });
    res.status(201).json(created);
  }));

  router.delete("/:id", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
    await ensureApparelOptionTables();
    const [option] = await query(`SELECT id, name, is_system FROM \`${config.table}\` WHERE id = :id LIMIT 1`, { id: req.params.id });
    if (!option) throw new HttpError(404, `${config.label} option not found.`);
    if (option.is_system || config.defaults.some((name) => name.toLowerCase() === String(option.name || "").toLowerCase())) {
      throw new HttpError(403, `Default ${config.label} options cannot be removed.`);
    }
    await query(`DELETE FROM \`${config.table}\` WHERE id = :id AND is_system = FALSE`, { id: req.params.id });
    res.json({ message: `${config.label} option removed.`, id: Number(req.params.id), name: option.name });
  }));

  return router;
}

export const categoriesRoutes = createOptionRouter("categories");
export const typesRoutes = createOptionRouter("types");
export const sizesRoutes = createOptionRouter("sizes");
export const conditionsRoutes = createOptionRouter("conditions");
export const brandsRoutes = createOptionRouter("brands");
export const colorsRoutes = createOptionRouter("colors");
