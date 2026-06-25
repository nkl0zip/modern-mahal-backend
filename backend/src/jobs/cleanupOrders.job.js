const pool = require("../config/db");
const cron = require("node-cron");

/**
 * Clean up pending orders older than 1 day
 * This should be scheduled to run daily (e.g., using node-cron)
 */
const cleanupPendingOrders = async () => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Find orders older than 1 day with PENDING status
    const pendingOrders = await client.query(
      `
      SELECT id, order_number 
      FROM orders 
      WHERE status = 'PENDING' 
        AND updated_at < NOW() - INTERVAL '1 day'
      `,
    );

    if (pendingOrders.rows.length === 0) {
      console.log("No pending orders older than 1 day found.");
      await client.query("COMMIT");
      return { deleted: 0, message: "No orders to cleanup" };
    }

    const orderIds = pendingOrders.rows.map((row) => row.id);
    console.log(`Found ${orderIds.length} pending orders to cleanup`);

    // Delete related records (cascade will handle most, but we need to handle payment_splits and order_deliveries)

    // 1. Delete payment splits (they cascade to pay_later_transactions if linked)
    await client.query(`DELETE FROM payment_splits WHERE order_id = ANY($1)`, [
      orderIds,
    ]);

    // 2. Delete payments
    await client.query(`DELETE FROM payments WHERE order_id = ANY($1)`, [
      orderIds,
    ]);

    // 3. Delete order deliveries
    await client.query(
      `DELETE FROM order_deliveries WHERE order_id = ANY($1)`,
      [orderIds],
    );

    // 4. Delete order notes
    await client.query(`DELETE FROM order_notes WHERE order_id = ANY($1)`, [
      orderIds,
    ]);

    // 5. Delete order items
    await client.query(`DELETE FROM order_items WHERE order_id = ANY($1)`, [
      orderIds,
    ]);

    // 6. Delete order status history
    await client.query(
      `DELETE FROM order_status_history WHERE order_id = ANY($1)`,
      [orderIds],
    );

    // 7. Finally delete the orders (cascade will handle references)
    const deleted = await client.query(
      `DELETE FROM orders WHERE id = ANY($1) RETURNING order_number`,
      [orderIds],
    );

    await client.query("COMMIT");

    console.log(`Successfully cleaned up ${deleted.rows.length} orders`);
    return {
      deleted: deleted.rows.length,
      orders: deleted.rows.map((row) => row.order_number),
      message: "Cleanup completed successfully",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error cleaning up pending orders:", error);
    throw error;
  } finally {
    client.release();
  }
};

// Run cleanup job every day at 3:00 AM
const startCleanupScheduler = () => {
  cron.schedule("0 3 * * *", async () => {
    console.log("Running daily order cleanup job...");
    try {
      const result = await cleanupPendingOrders();
      console.log("Cleanup result:", result);
    } catch (error) {
      console.error("Cleanup job failed:", error);
    }
  });
};

// For testing - run immediately
const runCleanupNow = async () => {
  return await cleanupPendingOrders();
};

module.exports = { startCleanupScheduler, runCleanupNow };
