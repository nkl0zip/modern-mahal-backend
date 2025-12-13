/* backend/migrations/1699999999999_create_ticket_system.js */
exports.shim = true;

exports.up = async (pgm) => {
  // ensure pgcrypto extension for gen_random_uuid()
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  /* --- ENUM types --- */
  pgm.sql(`
    CREATE TYPE ticket_status AS ENUM (
      'UNSOLVED',    -- default for user-created ticket
      'SOLVED',
      'HOLD',
      'IN_PROGRESS',
      'FAILED'
    );
  `);

  pgm.sql(`
    CREATE TYPE ticket_type AS ENUM (
      'ORDER_ISSUE',
      'PAYMENT',
      'DELIVERY',
      'PRODUCT_DEFECT',
      'RETURN_REFUND',
      'ACCOUNT',
      'TECHNICAL',
      'FEEDBACK',
      'OTHER'
    );
  `);

  pgm.sql(`
    CREATE TYPE ticket_action AS ENUM (
      'CREATED',
      'ASSIGNED',
      'TRANSFERRED',
      'STATUS_UPDATED',
      'COMMENT',
      'ATTACHMENT_ADDED',
      'DELETED',
      'CLOSED',
      'REOPENED'
    );
  `);

  /* --- tickets table --- */
  pgm.createTable("tickets", {
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
    title: { type: "varchar(255)", notNull: true },
    type: { type: "ticket_type", notNull: true, default: "OTHER" },
    message: { type: "text", notNull: true },
    status: { type: "ticket_status", notNull: true, default: "UNSOLVED" },
    priority: { type: "varchar(20)", notNull: false },
    assigned_staff_id: {
      type: "uuid",
      references: "users(id)",
      onDelete: "SET NULL",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    closed_at: { type: "timestamp" },
    is_deleted: { type: "boolean", notNull: true, default: false },
    deleted_at: { type: "timestamp" },
    total_resolution_seconds: { type: "bigint", default: 0 },
  });

  /* --- ticket_attachments table --- */
  pgm.createTable("ticket_attachments", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    ticket_id: {
      type: "uuid",
      notNull: true,
      references: "tickets(id)",
      onDelete: "CASCADE",
    },
    uploaded_by: {
      type: "uuid",
      references: "users(id)",
      onDelete: "SET NULL",
    },
    file_url: { type: "text", notNull: true },
    file_name: { type: "text" },
    file_size_bytes: { type: "bigint" },
    mime_type: { type: "varchar(255)" },
    cloudinary_public_id: { type: "text" },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  /* --- ticket_assignments table --- 
     Stores assignment periods for staff and duration per assignment.
     When staff picks up a ticket, create a new assignment with started_at.
     When staff resolves/unassigns, set ended_at and resolution_seconds (elapsed).
  */
  pgm.createTable("ticket_assignments", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    ticket_id: {
      type: "uuid",
      notNull: true,
      references: "tickets(id)",
      onDelete: "CASCADE",
    },
    staff_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    assigned_by: {
      type: "uuid",
      references: "users(id)",
      onDelete: "SET NULL",
    },
    assigned_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    ended_at: { type: "timestamp" },
    resolution_seconds: { type: "bigint", default: 0 },
    active: { type: "boolean", notNull: true, default: true },
  });

  /* --- ticket_activity table --- 
     Records all actions for an audit trail (creation, assign, transfer, status updates, comments)
  */
  pgm.createTable("ticket_activity", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    ticket_id: {
      type: "uuid",
      notNull: true,
      references: "tickets(id)",
      onDelete: "CASCADE",
    },
    actor_id: { type: "uuid", references: "users(id)", onDelete: "SET NULL" },
    action: { type: "ticket_action", notNull: true },
    action_data: {
      type: "jsonb",
      notNull: false,
      default: pgm.func("'{}'::jsonb"),
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  /* --- Indexes for fast filtering / list views --- */
  pgm.createIndex("tickets", ["status"]);
  pgm.createIndex("tickets", ["assigned_staff_id"]);
  pgm.createIndex("tickets", ["type"]);
  pgm.createIndex("tickets", ["created_at"]);

  pgm.createIndex("ticket_assignments", ["staff_id"]);
  pgm.createIndex("ticket_assignments", ["ticket_id"]);
  pgm.createIndex("ticket_activity", ["ticket_id"]);
  pgm.createIndex("ticket_attachments", ["ticket_id"]);
};

exports.down = async (pgm) => {
  // Drop tables in reverse order, then types
  pgm.dropIndex("ticket_attachments", ["ticket_id"]);
  pgm.dropIndex("ticket_activity", ["ticket_id"]);
  pgm.dropIndex("ticket_assignments", ["ticket_id"]);
  pgm.dropIndex("ticket_assignments", ["staff_id"]);
  pgm.dropIndex("tickets", ["created_at"]);
  pgm.dropIndex("tickets", ["type"]);
  pgm.dropIndex("tickets", ["assigned_staff_id"]);
  pgm.dropIndex("tickets", ["status"]);

  pgm.dropTable("ticket_attachments", { ifExists: true });
  pgm.dropTable("ticket_activity", { ifExists: true });
  pgm.dropTable("ticket_assignments", { ifExists: true });
  pgm.dropTable("tickets", { ifExists: true });

  pgm.sql(`DROP TYPE IF EXISTS ticket_action;`);
  pgm.sql(`DROP TYPE IF EXISTS ticket_type;`);
  pgm.sql(`DROP TYPE IF EXISTS ticket_status;`);
};
