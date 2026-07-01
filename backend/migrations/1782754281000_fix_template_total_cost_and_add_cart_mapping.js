exports.shim = true;

exports.up = async (pgm) => {
  // 1. Create table to store template ↔ cart mapping
  await pgm.createTable(
    "template_cart_mappings",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      template_id: {
        type: "uuid",
        notNull: true,
        references: "order_templates",
        onDelete: "CASCADE",
      },
      cart_id: {
        type: "uuid",
        notNull: true,
        references: "cart",
        onDelete: "CASCADE",
      },
      user_id: {
        type: "uuid",
        notNull: true,
        references: "users",
        onDelete: "CASCADE",
      },
      moved_at: {
        type: "timestamp",
        notNull: true,
        default: pgm.func("CURRENT_TIMESTAMP"),
      },
    },
    { ifNotExists: true },
  );

  // Ensure one mapping per template (a template can be in only one cart at a time)
  await pgm.addConstraint(
    "template_cart_mappings",
    "template_cart_mappings_template_id_unique",
    {
      unique: "template_id",
    },
  );

  await pgm.createIndex("template_cart_mappings", "cart_id");
  await pgm.createIndex("template_cart_mappings", "user_id");

  // 2. Fix the trigger to sum items with status != 'CANCELLED' (include ACTIVE & IN_CART)
  await pgm.sql(`
    CREATE OR REPLACE FUNCTION update_order_template_total_cost() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        UPDATE order_templates
        SET total_cost = COALESCE((
          SELECT SUM(unit_price_snapshot * quantity)
          FROM order_template_items
          WHERE template_id = OLD.template_id
          AND status != 'CANCELLED'
        ), 0)
        WHERE id = OLD.template_id;
      ELSE
        UPDATE order_templates
        SET total_cost = COALESCE((
          SELECT SUM(unit_price_snapshot * quantity)
          FROM order_template_items
          WHERE template_id = NEW.template_id
          AND status != 'CANCELLED'
        ), 0)
        WHERE id = NEW.template_id;
      END IF;
      RETURN NULL;
    END;
    $$;
  `);

  // 3. Recalculate total_cost for all existing templates in one go
  await pgm.sql(`
    UPDATE order_templates
    SET total_cost = COALESCE((
      SELECT SUM(unit_price_snapshot * quantity)
      FROM order_template_items
      WHERE template_id = order_templates.id
      AND status != 'CANCELLED'
    ), 0);
  `);
};

exports.down = async (pgm) => {
  await pgm.dropTable("template_cart_mappings", {
    ifExists: true,
    cascade: true,
  });
  // Revert trigger to original (sum only ACTIVE) if needed
  await pgm.sql(`
    CREATE OR REPLACE FUNCTION update_order_template_total_cost() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        UPDATE order_templates
        SET total_cost = COALESCE((
          SELECT SUM(unit_price_snapshot * quantity)
          FROM order_template_items
          WHERE template_id = OLD.template_id
          AND status = 'ACTIVE'
        ), 0)
        WHERE id = OLD.template_id;
      ELSE
        UPDATE order_templates
        SET total_cost = COALESCE((
          SELECT SUM(unit_price_snapshot * quantity)
          FROM order_template_items
          WHERE template_id = NEW.template_id
          AND status = 'ACTIVE'
        ), 0)
        WHERE id = NEW.template_id;
      END IF;
      RETURN NULL;
    END;
    $$;
  `);
};
