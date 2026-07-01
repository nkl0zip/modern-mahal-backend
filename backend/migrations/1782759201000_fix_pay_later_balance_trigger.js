exports.shim = true;

exports.up = async (pgm) => {
  // 1. Drop the existing trigger and function
  await pgm.sql(`
    DROP TRIGGER IF EXISTS trg_update_pay_later_balance ON pay_later_transactions;
  `);
  await pgm.sql(`
    DROP FUNCTION IF EXISTS update_user_pay_later_balance() CASCADE;
  `);

  // 2. Create the new trigger function with transaction_type logic
  await pgm.sql(`
    CREATE OR REPLACE FUNCTION update_user_pay_later_balance()
    RETURNS TRIGGER AS $$
    BEGIN
      -- For DEBIT, subtract the amount; for CREDIT/REPAYMENT, add the amount
      IF NEW.transaction_type = 'DEBIT' THEN
        UPDATE users
        SET pay_later_balance = pay_later_balance - NEW.amount,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.user_id;
      ELSIF NEW.transaction_type IN ('CREDIT', 'REPAYMENT') THEN
        UPDATE users
        SET pay_later_balance = pay_later_balance + NEW.amount,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.user_id;
      ELSE
        -- For 'SYSTEM' or other types, do nothing (or handle as needed)
        -- We'll still update updated_at for tracking but leave balance unchanged
        UPDATE users
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.user_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 3. Recreate the trigger
  await pgm.sql(`
    CREATE TRIGGER trg_update_pay_later_balance
    AFTER INSERT ON pay_later_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_user_pay_later_balance();
  `);
};

exports.down = async (pgm) => {
  // Revert to the old simple trigger (adds amount regardless of type)
  await pgm.sql(`
    DROP TRIGGER IF EXISTS trg_update_pay_later_balance ON pay_later_transactions;
  `);
  await pgm.sql(`
    DROP FUNCTION IF EXISTS update_user_pay_later_balance() CASCADE;
  `);

  await pgm.sql(`
    CREATE OR REPLACE FUNCTION update_user_pay_later_balance()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE users
      SET pay_later_balance = pay_later_balance + NEW.amount,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = NEW.user_id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await pgm.sql(`
    CREATE TRIGGER trg_update_pay_later_balance
    AFTER INSERT ON pay_later_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_user_pay_later_balance();
  `);
};
