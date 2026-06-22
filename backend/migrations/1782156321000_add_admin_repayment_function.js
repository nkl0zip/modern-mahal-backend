// migrations/1740000000001_add_admin_repayment_function.js
exports.shim = true;

exports.up = async (pgm) => {
  // Add function for admin-recorded repayments
  await pgm.sql(`
    CREATE OR REPLACE FUNCTION record_admin_repayment(
      p_user_id UUID,
      p_amount NUMERIC,
      p_payment_method VARCHAR,
      p_transaction_id VARCHAR,
      p_description TEXT,
      p_receipt_url TEXT,
      p_receipt_public_id TEXT,
      p_admin_id UUID,
      p_metadata JSONB
    )
    RETURNS JSONB AS $$
    DECLARE
      v_current_balance NUMERIC;
      v_new_balance NUMERIC;
      v_slab_limit NUMERIC;
      v_slab_id UUID;
      v_transaction_id UUID;
      v_result JSONB;
    BEGIN
      -- Get current balance with lock
      SELECT pay_later_balance, slab_id 
      INTO v_current_balance, v_slab_id
      FROM users 
      WHERE id = p_user_id 
      FOR UPDATE;
      
      IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found';
      END IF;
      
      -- Get slab limit if user has a slab
      IF v_slab_id IS NOT NULL THEN
        SELECT pay_later_limit INTO v_slab_limit 
        FROM user_slabs 
        WHERE id = v_slab_id;
      END IF;
      
      -- Calculate new balance
      v_new_balance := v_current_balance + p_amount;
      
      -- Cap at slab limit if exists
      IF v_slab_limit IS NOT NULL AND v_new_balance > v_slab_limit THEN
        v_new_balance := v_slab_limit;
      END IF;
      
      -- Insert transaction
      INSERT INTO pay_later_transactions (
        user_id, 
        transaction_type, 
        amount, 
        balance_after,
        payment_method, 
        transaction_id, 
        description, 
        receipt_url, 
        receipt_public_id, 
        approved_by, 
        metadata
      )
      VALUES (
        p_user_id, 
        'REPAYMENT', 
        p_amount, 
        v_new_balance,
        p_payment_method, 
        p_transaction_id, 
        p_description,
        p_receipt_url, 
        p_receipt_public_id, 
        p_admin_id,
        p_metadata || jsonb_build_object(
          'status', 'APPROVED', 
          'is_admin_recorded', true
        )
      )
      RETURNING id INTO v_transaction_id;
      
      -- Update user balance
      UPDATE users
      SET 
        pay_later_balance = v_new_balance,
        total_pay_later_repaid = total_pay_later_repaid + p_amount,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = p_user_id;
      
      -- Build result
      SELECT jsonb_build_object(
        'transaction_id', v_transaction_id,
        'user_id', p_user_id,
        'amount', p_amount,
        'new_balance', v_new_balance,
        'status', 'APPROVED'
      ) INTO v_result;
      
      RETURN v_result;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = async (pgm) => {
  // Drop the function
  await pgm.sql(
    `DROP FUNCTION IF EXISTS record_admin_repayment(UUID, NUMERIC, VARCHAR, VARCHAR, TEXT, TEXT, TEXT, UUID, JSONB);`,
  );
};
