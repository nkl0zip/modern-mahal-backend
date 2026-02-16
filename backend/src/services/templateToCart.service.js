const pool = require("../config/db");
const {
  getTemplateManualDiscounts,
} = require("../models/staff/discount.model");
const { applyTemplateDiscounts } = require("../services/discount.service");
const { recalculateCart } = require("./cartPricing.service");

const moveTemplateItemsToCart = async ({
  template_id,
  user_id,
  item_ids,
  mode,
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

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

    const { rows: items } = await client.query(
      `
      SELECT * FROM order_template_items
      WHERE template_id = $1
        AND status = 'ACTIVE'
        ${item_ids && item_ids.length ? `AND id = ANY($2)` : ""}
    `,
      item_ids && item_ids.length ? [template_id, item_ids] : [template_id],
    );

    if (!items.length) {
      throw { status: 400, message: "No valid items to move" };
    }

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

    if (mode === "REPLACE") {
      await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [
        cart.id,
      ]);

      await client.query(
        `UPDATE cart SET applied_coupon_id = NULL WHERE id = $1`,
        [cart.id],
      );
    }

    const discounts = await getTemplateManualDiscounts(template_id, user_id);

    const { items: discountedItems } = applyTemplateDiscounts(items, discounts);

    for (const item of discountedItems) {
      const manual_per_unit =
        Number(item.unit_price_snapshot) -
        Number(item.discounted_price || item.unit_price_snapshot);

      const existingRes = await client.query(
        `
        SELECT * FROM cart_items
        WHERE cart_id = $1 AND variant_id = $2
        LIMIT 1
      `,
        [cart.id, item.variant_id],
      );

      if (existingRes.rows.length) {
        const existing = existingRes.rows[0];

        const totalQty = Number(existing.quantity) + Number(item.quantity);

        const weightedManual =
          (Number(existing.quantity) *
            Number(existing.manual_discount_amount || 0) +
            Number(item.quantity) * manual_per_unit) /
          totalQty;

        await client.query(
          `
          UPDATE cart_items
          SET quantity = $1,
              manual_discount_amount = $2,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
        `,
          [totalQty, weightedManual, existing.id],
        );
      } else {
        await client.query(
          `
          INSERT INTO cart_items
          (cart_id, variant_id, quantity, unit_price_snapshot,
           manual_discount_amount, coupon_discount_amount,
           source_type, source_template_id, source_template_item_id)
          VALUES ($1,$2,$3,$4,$5,0,'TEMPLATE',$6,$7)
        `,
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

      await client.query(
        `
        UPDATE order_template_items
        SET status = 'IN_CART',
            moved_to_cart_at = CURRENT_TIMESTAMP,
            moved_cart_id = $1
        WHERE id = $2
      `,
        [cart.id, item.id],
      );
    }

    await client.query("COMMIT");

    const pricing = await recalculateCart(cart.id);

    return {
      cart_id: cart.id,
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
