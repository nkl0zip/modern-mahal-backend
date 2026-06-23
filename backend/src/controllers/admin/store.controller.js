// controllers/admin/store.controller.js
const {
  createStore,
  getAllStores,
  getStoreById,
  getStoreByCode,
  getActiveStoreForPublic,
  updateStore,
  getStoreOperatingHours,
  isStoreOpen,
} = require("../../models/admin/store.model");
const cloudinary = require("../../config/cloudinary");

/**
 * POST /api/admin/store
 * Create a new store (Admin only)
 */
const createStoreHandler = async (req, res, next) => {
  try {
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
      description,
      operating_hours,
      is_active = true,
      is_pickup_available = true,
      pickup_instructions,
    } = req.body;

    // Validate required fields
    if (!store_name) {
      return res.status(400).json({
        success: false,
        message: "Store name is required",
      });
    }

    if (!store_code) {
      return res.status(400).json({
        success: false,
        message: "Store code is required",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Validate email format
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    if (!address_line_1) {
      return res.status(400).json({
        success: false,
        message: "Address line 1 is required",
      });
    }

    if (!city) {
      return res.status(400).json({
        success: false,
        message: "City is required",
      });
    }

    if (!state) {
      return res.status(400).json({
        success: false,
        message: "State is required",
      });
    }

    if (!pincode) {
      return res.status(400).json({
        success: false,
        message: "Pincode is required",
      });
    }

    // Check if store code already exists
    const existingStore = await getStoreByCode(store_code);
    if (existingStore) {
      return res.status(400).json({
        success: false,
        message: `Store with code "${store_code}" already exists`,
      });
    }

    // Handle store image upload
    let storeImageUrl = null;
    let storeImagePublicId = null;

    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "store-images",
          resource_type: "image",
          allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
        });
        storeImageUrl = result.secure_url;
        storeImagePublicId = result.public_id;
      } catch (uploadError) {
        console.error("Cloudinary upload error:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload store image",
          error: uploadError.message,
        });
      }
    }

    // Parse operating hours if provided
    let parsedOperatingHours = {};
    if (operating_hours) {
      try {
        parsedOperatingHours =
          typeof operating_hours === "string"
            ? JSON.parse(operating_hours)
            : operating_hours;
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: "Invalid operating hours format. Must be valid JSON.",
        });
      }
    }

    // Create store
    const store = await createStore({
      store_name,
      store_code,
      email,
      address_line_1,
      address_line_2,
      city,
      state,
      pincode,
      country: country || "India",
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      google_maps_url,
      google_maps_embed_url,
      store_image_url: storeImageUrl,
      store_image_public_id: storeImagePublicId,
      description,
      operating_hours: parsedOperatingHours,
      is_active,
      is_pickup_available,
      pickup_instructions,
    });

    res.status(201).json({
      success: true,
      message: "Store created successfully",
      data: store,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/store
 * Get all stores (Admin)
 */
const getAllStoresHandler = async (req, res, next) => {
  try {
    const { include_inactive = "false" } = req.query;

    const stores = await getAllStores(include_inactive === "true");

    res.status(200).json({
      success: true,
      message: "Stores fetched successfully",
      data: stores,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/store/:id
 * Update store (Admin only)
 */
const updateStoreHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if store exists
    const existingStore = await getStoreById(id);
    if (!existingStore) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

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
      description,
      operating_hours,
      is_active,
      is_pickup_available,
      pickup_instructions,
    } = req.body;

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: "Invalid email format",
        });
      }
    }

    // Handle store image upload
    let storeImageUrl = existingStore.store_image_url;
    let storeImagePublicId = existingStore.store_image_public_id;

    if (req.file) {
      try {
        // Delete old image if exists
        if (existingStore.store_image_public_id) {
          await cloudinary.uploader.destroy(
            existingStore.store_image_public_id,
          );
        }

        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "store-images",
          resource_type: "image",
          allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
        });
        storeImageUrl = result.secure_url;
        storeImagePublicId = result.public_id;
      } catch (uploadError) {
        console.error("Cloudinary upload error:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload store image",
          error: uploadError.message,
        });
      }
    }

    // Parse operating hours if provided
    let parsedOperatingHours = undefined;
    if (operating_hours !== undefined) {
      try {
        parsedOperatingHours =
          typeof operating_hours === "string"
            ? JSON.parse(operating_hours)
            : operating_hours;
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: "Invalid operating hours format. Must be valid JSON.",
        });
      }
    }

    // Prepare update data
    const updateData = {};

    if (store_name !== undefined) updateData.store_name = store_name;
    if (store_code !== undefined) updateData.store_code = store_code;
    if (email !== undefined) updateData.email = email;
    if (address_line_1 !== undefined)
      updateData.address_line_1 = address_line_1;
    if (address_line_2 !== undefined)
      updateData.address_line_2 = address_line_2;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (pincode !== undefined) updateData.pincode = pincode;
    if (country !== undefined) updateData.country = country;
    if (latitude !== undefined)
      updateData.latitude = latitude ? parseFloat(latitude) : null;
    if (longitude !== undefined)
      updateData.longitude = longitude ? parseFloat(longitude) : null;
    if (google_maps_url !== undefined)
      updateData.google_maps_url = google_maps_url;
    if (google_maps_embed_url !== undefined)
      updateData.google_maps_embed_url = google_maps_embed_url;
    if (storeImageUrl) updateData.store_image_url = storeImageUrl;
    if (storeImagePublicId)
      updateData.store_image_public_id = storeImagePublicId;
    if (description !== undefined) updateData.description = description;
    if (parsedOperatingHours !== undefined)
      updateData.operating_hours = parsedOperatingHours;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (is_pickup_available !== undefined)
      updateData.is_pickup_available = is_pickup_available;
    if (pickup_instructions !== undefined)
      updateData.pickup_instructions = pickup_instructions;

    const updatedStore = await updateStore(id, updateData);

    res.status(200).json({
      success: true,
      message: "Store updated successfully",
      data: updatedStore,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/store/operating-hours
 * Get store operating hours (Public)
 */
const getStoreOperatingHoursHandler = async (req, res, next) => {
  try {
    const { day } = req.query;

    // Get the active store
    const store = await getActiveStoreForPublic();
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "No active store found",
      });
    }

    if (day) {
      const hours = await getStoreOperatingHours(store.id, day.toLowerCase());
      if (!hours) {
        return res.status(404).json({
          success: false,
          message: `No operating hours found for ${day}`,
        });
      }
      return res.status(200).json({
        success: true,
        message: `Operating hours for ${day} fetched successfully`,
        data: {
          day: day,
          ...hours,
        },
      });
    }

    // Return all operating hours
    res.status(200).json({
      success: true,
      message: "Operating hours fetched successfully",
      data: store.operating_hours || {},
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/store/is-open
 * Check if store is currently open (Public)
 */
const isStoreOpenHandler = async (req, res, next) => {
  try {
    const store = await getActiveStoreForPublic();
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "No active store found",
      });
    }

    const isOpen = await isStoreOpen(store.id);

    res.status(200).json({
      success: true,
      message: "Store status fetched successfully",
      data: {
        is_open: isOpen,
        store_name: store.store_name,
        current_time: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createStoreHandler,
  getAllStoresHandler,
  updateStoreHandler,
  getStoreOperatingHoursHandler,
  isStoreOpenHandler,
};
