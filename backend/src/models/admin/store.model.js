const pool = require("../../config/db");

/**
 * Create a new store
 */
const createStore = async (storeData) => {
  const {
    store_name,
    store_code,
    email,
    address_line_1,
    address_line_2,
    city,
    state,
    pincode,
    country = "India",
    latitude,
    longitude,
    google_maps_url,
    google_maps_embed_url,
    store_image_url,
    store_image_public_id,
    description,
    operating_hours = {},
    is_active = true,
    is_pickup_available = true,
    pickup_instructions,
  } = storeData;

  const { rows } = await pool.query(
    `
    INSERT INTO store_details (
      store_name, store_code, email, address_line_1, address_line_2,
      city, state, pincode, country, latitude, longitude,
      google_maps_url, google_maps_embed_url, store_image_url,
      store_image_public_id, description, operating_hours,
      is_active, is_pickup_available, pickup_instructions
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    RETURNING *;
    `,
    [
      store_name,
      store_code,
      email,
      address_line_1,
      address_line_2,
      city,
      state,
      pincode,
      country,
      latitude,
      longitude,
      google_maps_url,
      google_maps_embed_url,
      store_image_url,
      store_image_public_id,
      description,
      JSON.stringify(operating_hours),
      is_active,
      is_pickup_available,
      pickup_instructions,
    ],
  );
  return rows[0] || null;
};

/**
 * Get all stores
 */
const getAllStores = async (includeInactive = false) => {
  let query = `
    SELECT * FROM store_details
  `;

  if (!includeInactive) {
    query += ` WHERE is_active = true`;
  }

  query += ` ORDER BY created_at DESC;`;

  const { rows } = await pool.query(query);
  return rows;
};

/**
 * Get store by ID
 */
const getStoreById = async (store_id) => {
  const { rows } = await pool.query(
    `
    SELECT * FROM store_details WHERE id = $1;
    `,
    [store_id],
  );
  return rows[0] || null;
};

/**
 * Get store by store code
 */
const getStoreByCode = async (store_code) => {
  const { rows } = await pool.query(
    `
    SELECT * FROM store_details WHERE store_code = $1;
    `,
    [store_code],
  );
  return rows[0] || null;
};

/**
 * Get active store for public view
 */
const getActiveStoreForPublic = async () => {
  const { rows } = await pool.query(
    `
    SELECT 
      id, store_name, store_code, email,
      address_line_1, address_line_2, city, state, pincode, country,
      latitude, longitude, google_maps_url, google_maps_embed_url,
      store_image_url, description, operating_hours,
      is_pickup_available, pickup_instructions
    FROM store_details
    WHERE is_active = true
    ORDER BY created_at DESC
    LIMIT 1;
    `,
  );
  return rows[0] || null;
};

/**
 * Update store
 */
const updateStore = async (store_id, updateData) => {
  const {
    store_name,
    store_code,
    email,
    address_line_1,
    address_line_2,
    city,
    state,
    pincode,
    country,
    latitude,
    longitude,
    google_maps_url,
    google_maps_embed_url,
    store_image_url,
    store_image_public_id,
    description,
    operating_hours,
    is_active,
    is_pickup_available,
    pickup_instructions,
  } = updateData;

  const fields = [];
  const values = [];
  let paramCounter = 1;

  // Get current store for validation
  const currentStore = await getStoreById(store_id);
  if (!currentStore) {
    throw new Error("Store not found");
  }

  if (store_name !== undefined) {
    fields.push(`store_name = $${paramCounter}`);
    values.push(store_name);
    paramCounter++;
  }
  if (store_code !== undefined) {
    // Check if store code already exists (excluding current store)
    const existingCode = await pool.query(
      `SELECT id FROM store_details WHERE store_code = $1 AND id != $2`,
      [store_code, store_id],
    );
    if (existingCode.rows.length > 0) {
      throw new Error(`Store with code "${store_code}" already exists`);
    }
    fields.push(`store_code = $${paramCounter}`);
    values.push(store_code);
    paramCounter++;
  }
  if (email !== undefined) {
    fields.push(`email = $${paramCounter}`);
    values.push(email);
    paramCounter++;
  }
  if (address_line_1 !== undefined) {
    fields.push(`address_line_1 = $${paramCounter}`);
    values.push(address_line_1);
    paramCounter++;
  }
  if (address_line_2 !== undefined) {
    fields.push(`address_line_2 = $${paramCounter}`);
    values.push(address_line_2);
    paramCounter++;
  }
  if (city !== undefined) {
    fields.push(`city = $${paramCounter}`);
    values.push(city);
    paramCounter++;
  }
  if (state !== undefined) {
    fields.push(`state = $${paramCounter}`);
    values.push(state);
    paramCounter++;
  }
  if (pincode !== undefined) {
    fields.push(`pincode = $${paramCounter}`);
    values.push(pincode);
    paramCounter++;
  }
  if (country !== undefined) {
    fields.push(`country = $${paramCounter}`);
    values.push(country);
    paramCounter++;
  }
  if (latitude !== undefined) {
    fields.push(`latitude = $${paramCounter}`);
    values.push(latitude);
    paramCounter++;
  }
  if (longitude !== undefined) {
    fields.push(`longitude = $${paramCounter}`);
    values.push(longitude);
    paramCounter++;
  }
  if (google_maps_url !== undefined) {
    fields.push(`google_maps_url = $${paramCounter}`);
    values.push(google_maps_url);
    paramCounter++;
  }
  if (google_maps_embed_url !== undefined) {
    fields.push(`google_maps_embed_url = $${paramCounter}`);
    values.push(google_maps_embed_url);
    paramCounter++;
  }
  if (store_image_url !== undefined) {
    fields.push(`store_image_url = $${paramCounter}`);
    values.push(store_image_url);
    paramCounter++;
  }
  if (store_image_public_id !== undefined) {
    fields.push(`store_image_public_id = $${paramCounter}`);
    values.push(store_image_public_id);
    paramCounter++;
  }
  if (description !== undefined) {
    fields.push(`description = $${paramCounter}`);
    values.push(description);
    paramCounter++;
  }
  if (operating_hours !== undefined) {
    fields.push(`operating_hours = $${paramCounter}`);
    values.push(JSON.stringify(operating_hours));
    paramCounter++;
  }
  if (is_active !== undefined) {
    fields.push(`is_active = $${paramCounter}`);
    values.push(is_active);
    paramCounter++;
  }
  if (is_pickup_available !== undefined) {
    fields.push(`is_pickup_available = $${paramCounter}`);
    values.push(is_pickup_available);
    paramCounter++;
  }
  if (pickup_instructions !== undefined) {
    fields.push(`pickup_instructions = $${paramCounter}`);
    values.push(pickup_instructions);
    paramCounter++;
  }

  if (fields.length === 0) {
    throw new Error("No fields to update");
  }

  values.push(store_id);

  const query = `
    UPDATE store_details
    SET ${fields.join(", ")}
    WHERE id = $${paramCounter}
    RETURNING *;
  `;

  const { rows } = await pool.query(query, values);
  return rows[0] || null;
};

/**
 * Get store operating hours for a specific day
 */
const getStoreOperatingHours = async (store_id, day) => {
  const store = await getStoreById(store_id);
  if (!store || !store.operating_hours) {
    return null;
  }
  return store.operating_hours[day] || null;
};

/**
 * Check if store is open at a given time
 */
const isStoreOpen = async (store_id, date = new Date()) => {
  const store = await getStoreById(store_id);
  if (!store || !store.is_active) {
    return false;
  }

  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const day = days[date.getDay()];
  const hours = store.operating_hours?.[day];

  if (!hours || !hours.open || !hours.close || hours.is_closed) {
    return false;
  }

  const currentTime = date.getHours() * 60 + date.getMinutes();
  const openTime = hours.open
    .split(":")
    .reduce((h, m) => parseInt(h) * 60 + parseInt(m), 0);
  const closeTime = hours.close
    .split(":")
    .reduce((h, m) => parseInt(h) * 60 + parseInt(m), 0);

  return currentTime >= openTime && currentTime <= closeTime;
};

module.exports = {
  createStore,
  getAllStores,
  getStoreById,
  getStoreByCode,
  getActiveStoreForPublic,
  updateStore,
  getStoreOperatingHours,
  isStoreOpen,
};
