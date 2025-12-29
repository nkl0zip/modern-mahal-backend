/* backend/migrations/1736501000004_create_order_chat_system.js */

exports.shim = true;

exports.up = async (pgm) => {
  // Create ENUM types
  await pgm.createType("order_template_status", [
    "DRAFT",
    "ACTIVE",
    "COMPLETED",
    "CANCELLED",
  ]);

  await pgm.createType("order_item_status", [
    "ACTIVE",
    "CANCELLED",
    "IN_CART",
    "DELIVERED",
    "DELIVERING",
  ]);

  await pgm.createType("added_by_type", ["USER", "STAFF"]);

  await pgm.createType("chat_message_type", ["TEXT", "IMAGE", "AUDIO", "FILE"]);

  await pgm.createType("template_action_type", [
    "CREATED",
    "UPDATED",
    "ITEM_ADDED",
    "ITEM_REMOVED",
    "STATUS_CHANGED",
    "CHAT_SENT",
    "FINALIZED",
  ]);

  // Create order_templates table
  await pgm.createTable("order_templates", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    staff_id: { type: "uuid", references: "users(id)", onDelete: "SET NULL" },
    title: { type: "varchar(255)", notNull: true },
    description: { type: "text" },
    status: {
      type: "order_template_status",
      notNull: true,
      default: "DRAFT",
    },
    total_cost: {
      type: "numeric(12,2)",
      notNull: true,
      default: 0,
      check: "total_cost >= 0",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    finalized_at: { type: "timestamp" },
    is_deleted: { type: "boolean", notNull: true, default: false },
    deleted_at: { type: "timestamp" },
  });

  // Create order_template_items table
  await pgm.createTable("order_template_items", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    template_id: {
      type: "uuid",
      notNull: true,
      references: "order_templates(id)",
      onDelete: "CASCADE",
    },
    product_id: {
      type: "uuid",
      notNull: true,
      references: "products(id)",
      onDelete: "CASCADE",
    },
    variant_id: {
      type: "uuid",
      references: "product_variants(id)",
      onDelete: "CASCADE",
    },
    quantity: {
      type: "integer",
      notNull: true,
      default: 1,
      check: "quantity > 0",
    },
    unit_price_snapshot: {
      type: "numeric(10,2)",
      notNull: true,
      check: "unit_price_snapshot >= 0",
    },
    status: {
      type: "order_item_status",
      notNull: true,
      default: "ACTIVE",
    },
    last_status_date: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    added_by: {
      type: "added_by_type",
      notNull: true,
    },
    added_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    notes: { type: "text" },
  });

  // Create order_template_chats table
  await pgm.createTable("order_template_chats", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    template_id: {
      type: "uuid",
      notNull: true,
      references: "order_templates(id)",
      onDelete: "CASCADE",
    },
    sender_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    message: { type: "text" },
    message_type: {
      type: "chat_message_type",
      notNull: true,
      default: "TEXT",
    },
    is_read: { type: "boolean", notNull: true, default: false },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    deleted_at: { type: "timestamp" },
  });

  // Create order_template_attachments table
  await pgm.createTable("order_template_attachments", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    chat_id: {
      type: "uuid",
      notNull: true,
      references: "order_template_chats(id)",
      onDelete: "CASCADE",
    },
    cloudinary_public_id: { type: "text" },
    file_url: { type: "text", notNull: true },
    file_name: { type: "text" },
    file_size_bytes: { type: "bigint" },
    mime_type: { type: "varchar(255)" },
    uploaded_by: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create order_template_activity table
  await pgm.createTable("order_template_activity", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    template_id: {
      type: "uuid",
      notNull: true,
      references: "order_templates(id)",
      onDelete: "CASCADE",
    },
    actor_id: {
      type: "uuid",
      references: "users(id)",
      onDelete: "SET NULL",
    },
    action: {
      type: "template_action_type",
      notNull: true,
    },
    action_data: {
      type: "jsonb",
      default: "{}",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create unique constraint for order_template_items
  await pgm.addConstraint(
    "order_template_items",
    "order_template_items_template_product_variant_unique",
    {
      unique: ["template_id", "product_id", "variant_id"],
      ifNotExists: true,
    }
  );

  // Create indexes for order_templates
  await pgm.createIndex("order_templates", "user_id");
  await pgm.createIndex("order_templates", "staff_id");
  await pgm.createIndex("order_templates", "status");
  await pgm.createIndex("order_templates", "created_at");
  await pgm.createIndex("order_templates", ["user_id", "status"], {
    name: "order_templates_user_status_idx",
  });

  // Create indexes for order_template_items
  await pgm.createIndex("order_template_items", "template_id");
  await pgm.createIndex("order_template_items", "product_id");
  await pgm.createIndex("order_template_items", "variant_id");
  await pgm.createIndex("order_template_items", "status");
  await pgm.createIndex("order_template_items", ["template_id", "status"], {
    name: "order_template_items_template_status_idx",
  });
  await pgm.createIndex("order_template_items", "last_status_date");

  // Create indexes for order_template_chats
  await pgm.createIndex("order_template_chats", "template_id");
  await pgm.createIndex("order_template_chats", "sender_id");
  await pgm.createIndex("order_template_chats", ["template_id", "created_at"], {
    name: "order_template_chats_template_created_idx",
  });
  await pgm.createIndex("order_template_chats", ["template_id", "is_read"], {
    name: "order_template_chats_template_unread_idx",
    where: "is_read = false",
  });

  // Create indexes for order_template_attachments
  await pgm.createIndex("order_template_attachments", "chat_id");
  await pgm.createIndex("order_template_attachments", "uploaded_by");

  // Create indexes for order_template_activity
  await pgm.createIndex("order_template_activity", "template_id");
  await pgm.createIndex("order_template_activity", "actor_id");
  await pgm.createIndex("order_template_activity", "created_at");

  // Create function to update template total cost
  await pgm.sql(`
    CREATE OR REPLACE FUNCTION update_order_template_total_cost()
    RETURNS TRIGGER AS $$
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
    $$ LANGUAGE plpgsql;
  `);

  // Create trigger for updating total cost
  await pgm.sql(`
    CREATE TRIGGER trigger_update_template_total_cost
    AFTER INSERT OR UPDATE OR DELETE ON order_template_items
    FOR EACH ROW
    EXECUTE FUNCTION update_order_template_total_cost();
  `);

  // Create function to update updated_at timestamp
  await pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Add trigger for order_templates updated_at
  await pgm.sql(`
    CREATE TRIGGER update_order_templates_updated_at
    BEFORE UPDATE ON order_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  // Create function to update item status date
  await pgm.sql(`
    CREATE OR REPLACE FUNCTION update_item_status_date()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status != OLD.status THEN
        NEW.last_status_date = CURRENT_TIMESTAMP;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Add trigger for order_template_items status updates
  await pgm.sql(`
    CREATE TRIGGER update_order_template_items_status_date
    BEFORE UPDATE ON order_template_items
    FOR EACH ROW
    EXECUTE FUNCTION update_item_status_date();
  `);

  // Create function to automatically log activity
  await pgm.sql(`
    CREATE OR REPLACE FUNCTION log_order_template_activity()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO order_template_activity (template_id, actor_id, action, action_data)
        VALUES (NEW.id, NEW.user_id, 'CREATED', jsonb_build_object(
          'title', NEW.title,
          'status', NEW.status
        ));
      ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status != OLD.status THEN
          INSERT INTO order_template_activity (template_id, actor_id, action, action_data)
          VALUES (NEW.id, NEW.user_id, 'STATUS_CHANGED', jsonb_build_object(
            'old_status', OLD.status,
            'new_status', NEW.status
          ));
        END IF;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Add trigger for order_templates activity logging
  await pgm.sql(`
    CREATE TRIGGER log_order_templates_activity
    AFTER INSERT OR UPDATE ON order_templates
    FOR EACH ROW
    EXECUTE FUNCTION log_order_template_activity();
  `);

  // Create function to log chat activity
  await pgm.sql(`
    CREATE OR REPLACE FUNCTION log_chat_activity()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO order_template_activity (template_id, actor_id, action, action_data)
      VALUES (NEW.template_id, NEW.sender_id, 'CHAT_SENT', jsonb_build_object(
        'message_type', NEW.message_type,
        'has_attachment', EXISTS (
          SELECT 1 FROM order_template_attachments WHERE chat_id = NEW.id
        )
      ));
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Add trigger for chat activity logging
  await pgm.sql(`
    CREATE TRIGGER log_chat_activity_trigger
    AFTER INSERT ON order_template_chats
    FOR EACH ROW
    EXECUTE FUNCTION log_chat_activity();
  `);
};

exports.down = async (pgm) => {
  // Drop triggers first
  await pgm.sql(
    `DROP TRIGGER IF EXISTS log_chat_activity_trigger ON order_template_chats`
  );
  await pgm.sql(
    `DROP TRIGGER IF EXISTS log_order_templates_activity ON order_templates`
  );
  await pgm.sql(
    `DROP TRIGGER IF EXISTS update_order_template_items_status_date ON order_template_items`
  );
  await pgm.sql(
    `DROP TRIGGER IF EXISTS update_order_templates_updated_at ON order_templates`
  );
  await pgm.sql(
    `DROP TRIGGER IF EXISTS trigger_update_template_total_cost ON order_template_items`
  );

  // Drop functions
  await pgm.sql(`DROP FUNCTION IF EXISTS log_chat_activity`);
  await pgm.sql(`DROP FUNCTION IF EXISTS log_order_template_activity`);
  await pgm.sql(`DROP FUNCTION IF EXISTS update_item_status_date`);
  await pgm.sql(`DROP FUNCTION IF EXISTS update_updated_at_column`);
  await pgm.sql(`DROP FUNCTION IF EXISTS update_order_template_total_cost`);

  // Drop tables in reverse order
  await pgm.dropTable("order_template_activity", {
    ifExists: true,
    cascade: true,
  });
  await pgm.dropTable("order_template_attachments", {
    ifExists: true,
    cascade: true,
  });
  await pgm.dropTable("order_template_chats", {
    ifExists: true,
    cascade: true,
  });
  await pgm.dropTable("order_template_items", {
    ifExists: true,
    cascade: true,
  });
  await pgm.dropTable("order_templates", { ifExists: true, cascade: true });

  // Drop ENUM types
  await pgm.dropType("template_action_type", { ifExists: true });
  await pgm.dropType("chat_message_type", { ifExists: true });
  await pgm.dropType("added_by_type", { ifExists: true });
  await pgm.dropType("order_item_status", { ifExists: true });
  await pgm.dropType("order_template_status", { ifExists: true });
};
