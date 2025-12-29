const pool = require("../../config/db");

/**
 * Add chat message
 */
const addChatMessage = async ({
  template_id,
  sender_id,
  message,
  message_type = "TEXT",
}) => {
  const { rows } = await pool.query(
    `
    INSERT INTO order_template_chats (template_id, sender_id, message, message_type)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
    `,
    [template_id, sender_id, message, message_type]
  );
  return rows[0];
};

/**
 * Get chat messages for template
 */
const getTemplateChats = async (template_id, limit = 50, offset = 0) => {
  const { rows } = await pool.query(
    `
    SELECT 
      otc.*,
      u.name as sender_name,
      u.role as sender_role,
      ARRAY(
        SELECT jsonb_build_object(
          'id', ota.id,
          'file_url', ota.file_url,
          'file_name', ota.file_name,
          'mime_type', ota.mime_type
        )
        FROM order_template_attachments ota
        WHERE ota.chat_id = otc.id
      ) as attachments
    FROM order_template_chats otc
    JOIN users u ON otc.sender_id = u.id
    WHERE otc.template_id = $1 AND otc.deleted_at IS NULL
    ORDER BY otc.created_at DESC
    LIMIT $2 OFFSET $3;
    `,
    [template_id, limit, offset]
  );
  return rows;
};

/**
 * Mark messages as read
 */
const markMessagesAsRead = async (template_id, user_id) => {
  const { rowCount } = await pool.query(
    `
    UPDATE order_template_chats
    SET is_read = true
    WHERE template_id = $1 
      AND sender_id != $2 
      AND is_read = false
      AND deleted_at IS NULL
    `,
    [template_id, user_id]
  );
  return rowCount;
};

/**
 * Delete chat message (soft delete)
 */
const deleteChatMessage = async (chat_id, user_id) => {
  const { rows } = await pool.query(
    `
    UPDATE order_template_chats
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND sender_id = $2
    RETURNING *;
    `,
    [chat_id, user_id]
  );
  return rows[0] || null;
};

/**
 * Get unread message count
 */
const getUnreadMessageCount = async (template_id, user_id) => {
  const { rows } = await pool.query(
    `
    SELECT COUNT(*) as count
    FROM order_template_chats
    WHERE template_id = $1 
      AND sender_id != $2 
      AND is_read = false
      AND deleted_at IS NULL;
    `,
    [template_id, user_id]
  );
  return parseInt(rows[0].count);
};

/**
 * Add attachment to chat
 */
const addChatAttachment = async ({
  chat_id,
  cloudinary_public_id,
  file_url,
  file_name,
  file_size_bytes,
  mime_type,
  uploaded_by,
}) => {
  const { rows } = await pool.query(
    `
    INSERT INTO order_template_attachments (
      chat_id, cloudinary_public_id, file_url, file_name, 
      file_size_bytes, mime_type, uploaded_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *;
    `,
    [
      chat_id,
      cloudinary_public_id,
      file_url,
      file_name,
      file_size_bytes,
      mime_type,
      uploaded_by,
    ]
  );
  return rows[0];
};

/**
 * Get attachment by ID
 */
const getAttachmentById = async (attachment_id) => {
  const { rows } = await pool.query(
    `
    SELECT ota.*, otc.template_id, otc.sender_id
    FROM order_template_attachments ota
    JOIN order_template_chats otc ON ota.chat_id = otc.id
    WHERE ota.id = $1
    LIMIT 1;
    `,
    [attachment_id]
  );
  return rows[0] || null;
};

module.exports = {
  addChatMessage,
  getTemplateChats,
  markMessagesAsRead,
  deleteChatMessage,
  getUnreadMessageCount,
  addChatAttachment,
  getAttachmentById,
};
