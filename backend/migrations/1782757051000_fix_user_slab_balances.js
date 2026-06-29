exports.shim = true;

exports.up = async (pgm) => {
  // Fix all users who have pay_later_balance greater than their slab limit
  await pgm.sql(`
    UPDATE users u
    SET pay_later_balance = COALESCE(
      LEAST(
        u.pay_later_balance,
        s.pay_later_limit
      ),
      u.pay_later_balance
    )
    FROM user_slabs s
    WHERE u.slab_id = s.id
      AND u.pay_later_balance > s.pay_later_limit;
  `);

  // Fix users with no slab assigned - set balance to 0
  await pgm.sql(`
    UPDATE users
    SET pay_later_balance = 0
    WHERE slab_id IS NULL
      AND pay_later_balance > 0;
  `);

  // Log the fix
  await pgm.sql(`
    INSERT INTO pay_later_transactions (
      user_id,
      transaction_type,
      amount,
      balance_after,
      payment_method,
      description,
      approved_by,
      metadata
    )
    SELECT 
      u.id,
      'ADJUSTMENT',
      s.pay_later_limit - u.pay_later_balance,
      s.pay_later_limit,
      'SYSTEM',
      'Balance corrected to match slab limit',
      u.id,
      jsonb_build_object(
        'action', 'BALANCE_FIX',
        'previous_balance', u.pay_later_balance,
        'new_balance', s.pay_later_limit,
        'slab_id', u.slab_id,
        'slab_name', s.name
      )
    FROM users u
    JOIN user_slabs s ON u.slab_id = s.id
    WHERE u.pay_later_balance != s.pay_later_limit
      AND u.pay_later_balance > 0;
  `);
};

exports.down = async (pgm) => {
  // No down migration needed - this is a data fix
};
