// backend/controllers/staff/product.controller.js
const path = require("path");
const pool = require("../../config/db");
const fs = require("fs");
const { parseExcel } = require("../../utils/excelParser");
const {
  findIdByName,
  findOrCreateProductByCode,
  findOrCreateColour,
  createVariant,
  insertProductCategory,
  insertProductHighlights,
  getAllProductDetails,
  searchProducts,
  getBrandsProductList,
  getProductListBySearch,
  getProductDetailsById,
  getProductsByCategory,
  getProductOverviewPaginated,
  findOrCreateFinish,
  getProductsBySegment,
  findSegmentIdByName,
  insertProductSegments,
  getVariantsOverviewPaginated,
  updateProductDetails,
  updateProductCategories,
  updateProductSegments,
  softDeleteProduct,
  hardDeleteProduct,
} = require("../../models/staff/product.model");

/* ---------------------------------------------------
   Utility: Normalize Excel Row Headers
   --------------------------------------------------- */
function normalizeRowKeys(row) {
  const normalized = {};

  for (const key in row) {
    if (!key) continue;

    // trim spaces + lowercase
    const cleanKey = key.trim().toLowerCase();
    normalized[cleanKey] = row[key];
  }

  return normalized;
}

/* ---------------------------------------------------
   Utility: Parse comma / space separated Excel values
   --------------------------------------------------- */
function parseArr(value) {
  if (!value) return [];

  let result = [];

  // Excel libraries sometimes return arrays
  if (Array.isArray(value)) {
    result = value.map((v) => String(v).trim());
  }
  // Normal string input
  else if (typeof value === "string") {
    result = value
      // split on comma, pipe, or 2+ spaces
      .split(/,|\||\s{2,}/)
      .map((v) => v.trim());
  }

  // remove empty values + duplicates
  return [...new Set(result.filter(Boolean))];
}

/**
 * Bulk upload handler (Excel)
 * The sheet's headers:
 * Brand, Product, Category, Segment, Product Name, Product Code, Sub Code,
 * Colours, Finish, Description, Highlights, MRP, Alloy, Weight Capacity,
 * Usability, In Box Content, Warranty, Tags
 */
const uploadProductsFromExcel = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "Excel file is required. Please upload a file.",
      });
    }

    const filePath = req.file.path;

    // Parse Excel file
    const rawRows = parseExcel(filePath);

    // Normalize column headers ONCE
    const rows = rawRows.map(normalizeRowKeys);

    /* ---------- Validate Brands ---------- */
    for (const row of rows) {
      const brandName = row["brand"];
      const brandId = await findIdByName("brands", brandName);

      if (!brandId) {
        return res.status(401).json({
          message: `There is no brand named "${brandName}". Create this brand in the database.`,
        });
      }
    }

    /* ---------- Validate Categories ---------- */
    for (const row of rows) {
      const categoryName = row["product category"];
      const catId = await findIdByName("categories", categoryName);

      if (!catId) {
        return res.status(401).json({
          message: `There is no category named "${categoryName}". Create this category in the database.`,
        });
      }
    }

    /* ---------- Validate Segments ---------- */
    for (const row of rows) {
      const segmentNames = parseArr(row["segment"]);

      for (const seg of segmentNames) {
        const segId = await findSegmentIdByName(seg);
        if (!segId) {
          return res.status(400).json({
            message: `Segment "${seg}" does not exist. Please create it first.`,
          });
        }
      }
    }

    /* ---------- Process Rows ---------- */
    for (const row of rows) {
      if (!row["brand"] || !row["product code"]) continue;

      // Brand lookup
      const brand_id = await findIdByName("brands", row["brand"]);

      // Product master
      const productMaster = {
        name: row["product name"] || row["product"] || null,
        brand_id,
        product_code: row["product code"],
        description: row["description"] || null,
        segment: row["segment"] || null,
        warranty: row["warranty"] || null,
      };

      const createdProduct = await findOrCreateProductByCode(productMaster);

      /* ---------- Categories ---------- */
      const categoryNames = parseArr(row["product category"]);
      const categoryIds = [];

      for (const cat of categoryNames) {
        const catId = await findIdByName("categories", cat);
        if (catId) categoryIds.push(catId);
      }

      await insertProductCategory(createdProduct.id, categoryIds);

      /* ---------- Segments ---------- */
      const segmentNames = parseArr(row["segment"]);
      const segmentIds = [];

      for (const seg of segmentNames) {
        const segId = await findSegmentIdByName(seg);
        if (segId) segmentIds.push(segId);
      }

      await insertProductSegments(createdProduct.id, segmentIds);

      /* ---------- Highlights (robust) ---------- */
      const highlightsArr = parseArr(row["highlights"]);
      if (highlightsArr.length) {
        await insertProductHighlights(createdProduct.id, highlightsArr);
      }

      /* ---------- Variant ---------- */
      const variantData = {
        sub_code: row["sub code"] || null,
        colour: row["colours"] || null,
        colour_code: null,
        finish: row["finish"] || null,
        finish_code: null,
        mrp: row["mrp"] ? parseFloat(row["mrp"]) : null,
        alloy: parseArr(row["alloy"]) || null,
        weight_capacity: row["weight capacity"] || null,
        usability: parseArr(row["usability"]) || null,
        in_box_content: parseArr(row["in box content"]) || null,
        tags: Array.isArray(row["tags"])
          ? row["tags"].join(",")
          : row["tags"] || null,
        status: "ACTIVE",
      };

      await createVariant(createdProduct.id, variantData);
    }

    /* ---------- Cleanup ---------- */
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn("Failed to remove uploaded Excel file:", e.message);
    }

    res.json({ message: "Products uploaded and imported successfully." });
  } catch (err) {
    next(err);
  }
};

// Create single product + variant endpoint (keeps contract with earlier createSingleProductHandler)
const createSingleProductHandler = async (req, res, next) => {
  try {
    // Expecting product-level + variant-level fields in body
    const {
      name,
      brand,
      product_code,
      product_category,
      description,
      segment,
      warranty,

      // variant-level
      sub_code,
      colour,
      finish,
      mrp,
      alloy,
      weight_capacity,
      usability,
      in_box_content,
      tags,
      highlights,
      status,
    } = req.body;

    // Brand lookup
    const brand_id = brand ? await findIdByName("brands", brand) : null;
    if (!brand_id) {
      return res
        .status(400)
        .json({ message: "Brand not found. Please provide a valid brand." });
    }

    // Create or find product master
    const productMaster = {
      name,
      brand_id,
      product_code,
      description: description || null,
      segment: segment || null,
      warranty: warranty || null,
    };
    const createdProduct = await findOrCreateProductByCode(productMaster);

    // Product categories
    const categoryNames = parseArr(product_category);
    const categoryIds = [];
    for (const cat of categoryNames) {
      const catId = await findIdByName("categories", cat);
      if (catId) categoryIds.push(catId);
    }
    await insertProductCategory(createdProduct.id, categoryIds);

    /* ---------- Segments ---------- */
    const segmentNames = parseArr(segment);
    const segmentIds = [];

    for (const seg of segmentNames) {
      const segId = await findSegmentIdByName(seg);
      if (!segId) {
        return res.status(400).json({
          message: `Segment "${seg}" does not exist.`,
        });
      }
      segmentIds.push(segId);
    }

    await insertProductSegments(createdProduct.id, segmentIds);

    // Product highlights (product-level)
    await insertProductHighlights(createdProduct.id, parseArr(highlights));

    // Create variant
    const variantData = {
      sub_code,
      colour,
      finish,
      mrp: mrp ? parseFloat(mrp) : null,
      alloy,
      weight_capacity,
      usability: Array.isArray(usability)
        ? usability.join(",")
        : usability || null,
      in_box_content: Array.isArray(in_box_content)
        ? in_box_content.join(",")
        : in_box_content || null,
      tags: Array.isArray(tags) ? tags.join(",") : tags || null,
      status: status,
    };

    const createdVariant = await createVariant(createdProduct.id, variantData);

    // Reply with both product and variant info (like before, but now includes variant)
    return res.status(201).json({
      message: "Product and variant created successfully.",
      product: {
        ...createdProduct,
      },
      variant: {
        ...createdVariant,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Helper Function
function normalizeNameInput(value) {
  if (!value) return null;

  // If array → take first valid item
  if (Array.isArray(value)) {
    return normalizeNameInput(value[0]);
  }

  // If object → look for .name
  if (typeof value === "object") {
    if (value.name) return String(value.name).trim();
    return null;
  }

  // If number → convert to string
  if (typeof value === "number") {
    return String(value).trim();
  }

  // If string → trim
  if (typeof value === "string") {
    const n = value.trim();
    return n.length > 0 ? n : null;
  }

  return null;
}

// For creating a new variant for an existing product
const createVariantHandler = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const {
      sub_code,
      colour, // string e.g. "Black" or { name, code }
      finish, // string or { name, code }
      mrp,
      alloy,
      weight_capacity,
      usability,
      in_box_content,
      tags,
      status,
    } = req.body;

    // 1) Ensure product exists
    const product = await getProductDetailsById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // 2) Colour: support either "Black" or { name: "Black", code: "BLK" }
    let colour_id = null;
    if (colour) {
      const colourName = normalizeNameInput(colour);

      if (colourName) {
        colour_id = await findOrCreateColour(colourName);
      }
    }

    // 3) Finish
    let finish_id = null;
    if (finish) {
      const finishName = normalizeNameInput(finish);

      if (finishName) {
        finish_id = await findOrCreateFinish(finishName);
      }
    }

    // 4) Build variant object to insert
    const variantObj = {
      sub_code: sub_code || null,
      colour_id: colour_id,
      finish_id: finish_id,
      mrp: mrp ? parseFloat(mrp) : null,
      alloy: alloy || null,
      weight_capacity: weight_capacity || null,
      usability: usability || null,
      in_box_content: in_box_content || null,
      tags: tags || null,
      status: status,
    };

    // 5) Create variant
    const newVariant = await createVariant(productId, variantObj);

    return res.status(201).json({
      message: "Variant created successfully",
      variant: newVariant,
    });
  } catch (err) {
    next(err);
  }
};

// The rest of the controller handlers call model functions which now return variants as part of product responses.
// Minimal changes required here — simply forwarding model results to client.

const getAllProductsHandler = async (req, res, next) => {
  try {
    const products = await getAllProductDetails();
    res
      .status(200)
      .json({ message: "Products fetched successfully.", products });
  } catch (err) {
    next(err);
  }
};

const searchProductsHandler = async (req, res, next) => {
  try {
    const { name, code } = req.query;
    if (!name && !code) {
      return res.status(400).json({
        message: "Please provide a product name or product code to search.",
      });
    }
    const products = await searchProducts({ name, code });
    if (!products || products.length === 0) {
      return res.status(404).json({
        message: "No product exists with such name/code. Try something else.",
        products: [],
      });
    }
    res
      .status(200)
      .json({ message: "Products fetched successfully.", products });
  } catch (err) {
    next(err);
  }
};

const getBrandsProductListHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { page = 1 } = req.query;

    if (!id) {
      return res.status(400).json({ message: "Brand ID is required" });
    }

    const pageNum = parseInt(page, 10) || 1;
    const user = req.user || null;

    const { products, total_count, brand_name } = await getBrandsProductList({
      brand_id: id,
      page: pageNum,
      limit: 20,
      user,
    });

    if (!products || products.length === 0) {
      return res.status(404).json({
        message: "No products found for this brand.",
        brand_name,
        products: [],
      });
    }

    return res.status(200).json({
      message: "Brand products fetched successfully.",
      brand_name,
      page: pageNum,
      per_page: 20,
      total_count,
      total_pages: Math.ceil(total_count / 20),
      next_page: pageNum * 20 < total_count ? pageNum + 1 : null,
      prev_page: pageNum > 1 ? pageNum - 1 : null,
      products,
    });
  } catch (error) {
    console.error("Error fetching brand products:", error);
    next(error);
  }
};

const getProductListBySearchHandler = async (req, res, next) => {
  try {
    const { name, page = 1 } = req.query;

    if (!name) {
      return res
        .status(400)
        .json({ message: "Search term 'name' is required." });
    }

    const pageNum = parseInt(page, 10) || 1;
    const user = req.user || null;

    const { products, total_count } = await getProductListBySearch({
      name,
      page: pageNum,
      user,
    });

    return res.status(200).json({
      message: "Products fetched successfully.",
      page: pageNum,
      per_page: 20,
      total_count,
      total_pages: Math.ceil(total_count / 20),
      next_page: pageNum * 20 < total_count ? pageNum + 1 : null,
      prev_page: pageNum > 1 ? pageNum - 1 : null,
      products,
    });
  } catch (error) {
    console.error("Error in paginated fuzzy search:", error);
    next(error);
  }
};

const getProductOverviewPaginatedHandler = async (req, res, next) => {
  try {
    const { page = 1 } = req.query;
    const pageNum = parseInt(page, 10) || 1;

    const user = req.user || null;

    const { products, total_count } = await getProductOverviewPaginated({
      page: pageNum,
      user,
    });

    return res.status(200).json({
      message: "Product overview fetched.",
      page: pageNum,
      per_page: 20,
      total_count,
      total_pages: Math.ceil(total_count / 20),
      next_page: pageNum * 20 < total_count ? pageNum + 1 : null,
      prev_page: pageNum > 1 ? pageNum - 1 : null,
      products,
    });
  } catch (error) {
    console.error("Error fetching product overview:", error);
    next(error);
  }
};

const getProductDetailsByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(401).json({ message: "Product_Id is required" });
    const product = await getProductDetailsById(id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    return res
      .status(200)
      .json({ message: "Product fetched successfully", data: product });
  } catch (err) {
    console.error("Error fetching the product list: ", err);
    next(err);
  }
};

const getProductsByCategoryHandler = async (req, res, next) => {
  try {
    const { id, name, page = 1 } = req.query;
    if (!id && !name)
      return res.status(400).json({
        message: "Please provide either 'id' or 'name' for category.",
      });
    const pageNum = parseInt(page, 10) || 1;
    const { products, total_count } = await getProductsByCategory({
      category_id: id,
      category_name: name,
      page: pageNum,
      limit: 20,
    });
    if (!products || products.length === 0) {
      return res.status(404).json({
        message: "No products found for this category.",
        products: [],
      });
    }
    return res.status(200).json({
      message: "Category products fetched successfully.",
      page: pageNum,
      per_page: 20,
      total_count,
      total_pages: Math.ceil(total_count / 20),
      next_page: pageNum * 20 < total_count ? pageNum + 1 : null,
      prev_page: pageNum > 1 ? pageNum - 1 : null,
      products,
    });
  } catch (error) {
    console.error("Error fetching category products (paginated):", error);
    next(error);
  }
};

const getProductsBySegmentHandler = async (req, res, next) => {
  try {
    const { id, name, page = 1 } = req.query;

    if (!id && !name) {
      return res.status(400).json({
        message: "Please provide segment id or name",
      });
    }

    const pageNum = parseInt(page, 10) || 1;

    const { products, total_count } = await getProductsBySegment({
      segment_id: id,
      segment_name: name,
      page: pageNum,
      limit: 20,
    });

    if (!products.length) {
      return res.status(404).json({
        message: "No products found for this segment",
        products: [],
      });
    }

    res.status(200).json({
      message: "Segment products fetched successfully",
      page: pageNum,
      per_page: 20,
      total_count,
      total_pages: Math.ceil(total_count / 20),
      products,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/products/variants/overview
 * Admin & Staff – paginated variant-level listing
 */
const getVariantsOverviewPaginatedHandler = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (pageNum <= 0 || limitNum <= 0) {
      return res.status(400).json({
        message: "page and limit must be positive integers",
      });
    }

    const { variants, total_count } = await getVariantsOverviewPaginated({
      page: pageNum,
      limit: limitNum,
    });

    return res.status(200).json({
      message: "Variants overview fetched successfully.",
      page: pageNum,
      per_page: limitNum,
      total_count,
      total_pages: Math.ceil(total_count / limitNum),
      next_page: pageNum * limitNum < total_count ? pageNum + 1 : null,
      prev_page: pageNum > 1 ? pageNum - 1 : null,
      variants,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/products/:id
 * ADMIN / STAFF - Update product details
 */
const updateProductHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, brand_id, description, warranty, categories, segments } =
      req.body;

    if (!id) {
      return res.status(400).json({ message: "Product ID is required" });
    }

    // Validate product exists
    const existingProduct = await getProductDetailsById(id);
    if (!existingProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Validate brand_id if provided
    if (brand_id) {
      const brandCheck = await pool.query(
        "SELECT id FROM brands WHERE id = $1",
        [brand_id]
      );
      if (brandCheck.rows.length === 0) {
        return res.status(400).json({ message: "Invalid brand_id provided" });
      }
    }

    // Prepare product update data
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (brand_id !== undefined) updateData.brand_id = brand_id;
    if (description !== undefined) updateData.description = description;
    if (warranty !== undefined) updateData.warranty = warranty;

    let updatedProduct = null;
    let updatedCategories = null;
    let updatedSegments = null;

    // Update product details if any fields provided
    if (Object.keys(updateData).length > 0) {
      updatedProduct = await updateProductDetails(id, updateData);
    }

    // Update categories if provided
    if (categories !== undefined) {
      const categoryIds = Array.isArray(categories) ? categories : [];
      // Validate category IDs exist
      if (categoryIds.length > 0) {
        const { rows } = await pool.query(
          "SELECT id FROM categories WHERE id = ANY($1)",
          [categoryIds]
        );
        if (rows.length !== categoryIds.length) {
          return res.status(400).json({
            message: "One or more category IDs are invalid",
          });
        }
      }
      updatedCategories = await updateProductCategories(id, categoryIds);
    }

    // Update segments if provided
    if (segments !== undefined) {
      const segmentIds = Array.isArray(segments) ? segments : [];
      // Validate segment IDs exist
      if (segmentIds.length > 0) {
        const { rows } = await pool.query(
          "SELECT id FROM segments WHERE id = ANY($1)",
          [segmentIds]
        );
        if (rows.length !== segmentIds.length) {
          return res.status(400).json({
            message: "One or more segment IDs are invalid",
          });
        }
      }
      updatedSegments = await updateProductSegments(id, segmentIds);
    }

    // If nothing was updated
    if (!updatedProduct && categories === undefined && segments === undefined) {
      return res.status(400).json({
        message: "No fields provided for update",
      });
    }

    // Get the full updated product details
    const fullProductDetails = await getProductDetailsById(id);

    return res.status(200).json({
      message: "Product updated successfully",
      product: fullProductDetails,
      changes: {
        details_updated: !!updatedProduct,
        categories_updated: categories !== undefined,
        segments_updated: segments !== undefined,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/products/:id/soft-delete
 * ADMIN / STAFF - Soft delete product (mark all variants as DISCONTINUED)
 */
const softDeleteProductHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "Product ID is required" });
    }

    // Validate product exists
    const existingProduct = await getProductDetailsById(id);
    if (!existingProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if already all variants are DISCONTINUED
    const { rows: variants } = await pool.query(
      "SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status != 'DISCONTINUED') as active FROM product_variants WHERE product_id = $1",
      [id]
    );

    if (parseInt(variants[0].active) === 0) {
      return res.status(400).json({
        message: "Product already has all variants marked as DISCONTINUED",
        product: existingProduct,
      });
    }

    const result = await softDeleteProduct(id);

    return res.status(200).json({
      message:
        "Product soft deleted successfully (all variants marked as DISCONTINUED)",
      product: result.product,
      updated_variants_count: result.updated_variants.length,
      updated_variants: result.updated_variants,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/products/:id
 * ADMIN only - Hard delete product (permanent deletion)
 */
const hardDeleteProductHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { force } = req.query; // Optional force flag

    if (!id) {
      return res.status(400).json({ message: "Product ID is required" });
    }

    // Validate product exists
    const existingProduct = await getProductDetailsById(id);
    if (!existingProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    let deletedProduct;

    if (force === "true") {
      // Force delete even with cart items (ADMIN override)
      // This requires a different approach - we might need to handle cart items first
      // For now, we'll reject force delete if cart items exist
      const cartCheck = await pool.query(
        `SELECT COUNT(*) as count 
         FROM cart_items ci
         JOIN product_variants pv ON ci.variant_id = pv.id
         WHERE pv.product_id = $1`,
        [id]
      );

      if (parseInt(cartCheck.rows[0].count) > 0) {
        return res.status(400).json({
          message: `Cannot force delete: Product variants are in ${cartCheck.rows[0].count} cart items. Remove from carts first.`,
          suggestion: "Use soft delete instead",
        });
      }

      deletedProduct = await hardDeleteProduct(id);
    } else {
      // Normal delete with validation
      deletedProduct = await hardDeleteProduct(id);
    }

    return res.status(200).json({
      message: "Product permanently deleted successfully",
      product: deletedProduct,
    });
  } catch (err) {
    // Handle reference constraint errors
    if (err.message.includes("Cannot delete product")) {
      return res.status(400).json({
        message: err.message,
        suggestion: "Use soft delete or remove references first",
      });
    }
    next(err);
  }
};

module.exports = {
  uploadProductsFromExcel,
  getAllProductsHandler,
  searchProductsHandler,
  createSingleProductHandler,
  getBrandsProductListHandler,
  getProductListBySearchHandler,
  getProductDetailsByIdHandler,
  getProductsByCategoryHandler,
  getProductOverviewPaginatedHandler,
  createVariantHandler,
  getProductsBySegmentHandler,
  getVariantsOverviewPaginatedHandler,
  updateProductHandler,
  softDeleteProductHandler,
  hardDeleteProductHandler,
};
