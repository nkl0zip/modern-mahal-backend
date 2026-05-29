exports.shim = true;

exports.up = async (pgm) => {
  await pgm.addColumns(
    "users",
    {
      totp_secret: { type: "text" },
      totp_enabled: { type: "boolean", default: false },
      totp_backup_codes: { type: "jsonb", default: "[]" },
    },
    { ifNotExists: true },
  );
};

exports.down = async (pgm) => {
  await pgm.dropColumns(
    "users",
    ["totp_secret", "totp_enabled", "totp_backup_codes"],
    { ifExists: true },
  );
};
