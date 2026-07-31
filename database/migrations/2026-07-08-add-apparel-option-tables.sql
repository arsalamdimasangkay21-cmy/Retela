CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_categories_name (name)
);

CREATE TABLE IF NOT EXISTS types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_types_name (name)
);

CREATE TABLE IF NOT EXISTS sizes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sizes_name (name)
);

CREATE TABLE IF NOT EXISTS conditions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_conditions_name (name)
);

INSERT INTO categories (name)
SELECT value FROM (
  SELECT 'T-Shirts' AS value UNION SELECT 'Jackets' UNION SELECT 'Caps' UNION SELECT 'Other'
) defaults
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(categories.name) = LOWER(defaults.value));

INSERT INTO types (name)
SELECT value FROM (
  SELECT 'Men' AS value UNION SELECT 'Women' UNION SELECT 'Kids' UNION SELECT 'Vintage' UNION SELECT 'Oversized' UNION SELECT 'Streetwear' UNION SELECT 'Sportswear' UNION SELECT 'Formal' UNION SELECT 'Casual' UNION SELECT 'Unisex' UNION SELECT 'Other'
) defaults
WHERE NOT EXISTS (SELECT 1 FROM types WHERE LOWER(types.name) = LOWER(defaults.value));

INSERT INTO sizes (name)
SELECT value FROM (
  SELECT 'XS' AS value UNION SELECT 'S' UNION SELECT 'M' UNION SELECT 'L' UNION SELECT 'XL' UNION SELECT 'XXL' UNION SELECT 'Free Size' UNION SELECT 'Other'
) defaults
WHERE NOT EXISTS (SELECT 1 FROM sizes WHERE LOWER(sizes.name) = LOWER(defaults.value));

INSERT INTO conditions (name)
SELECT value FROM (
  SELECT 'Like New' AS value UNION SELECT 'Excellent' UNION SELECT 'Very Good' UNION SELECT 'Good' UNION SELECT 'Fair' UNION SELECT 'Other'
) defaults
WHERE NOT EXISTS (SELECT 1 FROM conditions WHERE LOWER(conditions.name) = LOWER(defaults.value));

ALTER TABLE apparel_items MODIFY category VARCHAR(80) NOT NULL DEFAULT 'T-Shirts';
ALTER TABLE apparel_items MODIFY gender VARCHAR(80) DEFAULT 'Other';
ALTER TABLE apparel_items MODIFY size VARCHAR(80) DEFAULT 'Free Size';
