const pool = require("../config/db");
const {
  getTemplateManualDiscounts,
} = require("../models/staff/discount.model");
const { applyTemplateDiscounts } = require("../services/discount.service");
const { recalculateCart } = require("./cartPricing.service");

const moveTemplateItemsToCart = async ({
  template_id,
  user_id,
  item_ids = null, // optional array of specific item IDs
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Validate template
    const { rows: templateRows } = await client.query(
      `SELECT * FROM order_templates WHERE id = $1 AND user_id = $2 AND is_deleted = false`,
      [template_id, user_id],
    );

    if (!templateRows.length) {
      throw { status: 404, message: "Template not found" };
    }

    const template = templateRows[0];

    if (template.status === "CANCELLED") {
      throw { status: 400, message: "Cannot move cancelled template" };
    }

    // 2. Get items to move (ACTIVE or IN_CART)
    let query = `
      SELECT * FROM order_template_items
      WHERE template_id = $1
        AND status IN ('ACTIVE', 'IN_CART')
    `;
    let params = [template_id];

    if (item_ids && item_ids.length) {
      query += ` AND id = ANY($2)`;
      params.push(item_ids);
    }

    const { rows: items } = await client.query(query, params);

    if (!items.length) {
      throw { status: 400, message: "No valid items to move" };
    }

    // 3. Get or create user's cart
    const { rows: cartRows } = await client.query(
      `SELECT * FROM cart WHERE user_id = $1 LIMIT 1`,
      [user_id],
    );

    let cart;
    if (cartRows.length) {
      cart = cartRows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO cart (user_id) VALUES ($1) RETURNING *`,
        [user_id],
      );
      cart = inserted.rows[0];
    }

    // 4. Check if this template is already mapped to this cart
    const existingMapping = await client.query(
      `SELECT cart_id FROM template_cart_mappings WHERE template_id = $1 AND user_id = $2`,
      [template_id, user_id],
    );

    const isSameTemplateAlreadyInCart = existingMapping.rows.length > 0;

    // 5. Determine mode internally
    let mode = "COMBINE"; // default

    // If this template is already in the cart, replace its items
    if (isSameTemplateAlreadyInCart) {
      mode = "REPLACE";
    }

    // 6. Handle the mode
    if (mode === "REPLACE") {
      // This template already has items in the cart - remove them first
      // Get the template item IDs that are currently in the cart for this template
      const itemsToRevert = await client.query(
        `SELECT source_template_item_id FROM cart_items
         WHERE cart_id = $1 AND source_template_id = $2`,
        [cart.id, template_id],
      );

      const templateItemIds = itemsToRevert.rows.map(
        (r) => r.source_template_item_id,
      );

      if (templateItemIds.length > 0) {
        // Revert those template items back to ACTIVE
        await client.query(
          `UPDATE order_template_items
           SET status = 'ACTIVE', moved_to_cart_at = NULL, moved_cart_id = NULL
           WHERE id = ANY($1)`,
          [templateItemIds],
        );
      }

      // Delete the old cart items for this template
      await client.query(
        `DELETE FROM cart_items WHERE cart_id = $1 AND source_template_id = $2`,
        [cart.id, template_id],
      );

      // The mapping remains the same (upserted later)
    } else {
      // COMBINE mode: this is a new template being added to the cart
      // No need to remove anything, just add the new items
      // The mapping will be created later
    }

    // 7. Apply discounts to the items we are about to move
    const discounts = await getTemplateManualDiscounts(template_id, user_id);
    const { items: discountedItems } = applyTemplateDiscounts(items, discounts);

    // 8. Insert (or update) each item into the cart
    for (const item of discountedItems) {
      const manual_per_unit =
        Number(item.unit_price_snapshot) -
        Number(item.discounted_price || item.unit_price_snapshot);

      // Check if variant already exists in cart (from other sources, e.g. direct add or other templates)
      const existingRes = await client.query(
        `SELECT * FROM cart_items
         WHERE cart_id = $1 AND variant_id = $2
         LIMIT 1`,
        [cart.id, item.variant_id],
      );

      if (existingRes.rows.length) {
        const existing = existingRes.rows[0];
        const totalQty = Number(existing.quantity) + Number(item.quantity);

        // Weighted average of manual discount
        const weightedManual =
          (Number(existing.quantity) *
            Number(existing.manual_discount_amount || 0) +
            Number(item.quantity) * manual_per_unit) /
          totalQty;

        await client.query(
          `UPDATE cart_items
           SET quantity = $1,
               manual_discount_amount = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [totalQty, weightedManual, existing.id],
        );
      } else {
        await client.query(
          `INSERT INTO cart_items
           (cart_id, variant_id, quantity, unit_price_snapshot,
            manual_discount_amount, coupon_discount_amount,
            source_type, source_template_id, source_template_item_id)
           VALUES ($1, $2, $3, $4, $5, 0, 'TEMPLATE', $6, $7)`,
          [
            cart.id,
            item.variant_id,
            item.quantity,
            item.unit_price_snapshot,
            manual_per_unit,
            template_id,
            item.id,
          ],
        );
      }

      // Mark the template item as IN_CART
      await client.query(
        `UPDATE order_template_items
         SET status = 'IN_CART',
             moved_to_cart_at = CURRENT_TIMESTAMP,
             moved_cart_id = $1
         WHERE id = $2`,
        [cart.id, item.id],
      );
    }

    // 9. Upsert the mapping: this template is now in this cart
    await client.query(
      `INSERT INTO template_cart_mappings (template_id, cart_id, user_id, moved_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (template_id) DO UPDATE
       SET cart_id = EXCLUDED.cart_id,
           user_id = EXCLUDED.user_id,
           moved_at = EXCLUDED.moved_at`,
      [template_id, cart.id, user_id],
    );

    await client.query("COMMIT");

    // 10. Recalculate cart totals (tax, etc.)
    const pricing = await recalculateCart(cart.id);

    return {
      cart_id: cart.id,
      mode: mode, // Return the mode that was used
      pricing,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
module.exports = {
  moveTemplateItemsToCart,
};
