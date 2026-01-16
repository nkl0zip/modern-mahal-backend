// backend/routes/staff/product.routes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const {
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
} = require("../../controllers/staff/product.controller");
const {
  authenticateToken,
  requireRole,
  optionalAuthenticateToken,
} = require("../../middlewares/auth.middleware");

// Configureing multer for excel upload
const upload = multer({
  dest: path.join(__dirname, "../../uploads/"),
  fileFilter: (req, file, cb) => {
    // Only accept xlsx or xls
    if (
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.mimetype === "application/vnd.ms-excel"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files are allowed!"), false);
    }
  },
});

const router = express.Router();

// POST /api/products/upload-excel
// Allowed for ADMIN/STAFF
router.post("/upload-excel", upload.single("file"), uploadProductsFromExcel);

// GET /api/products
// For ADMIN/STAFF
router.get("/", getAllProductsHandler);

// Allowed for all roles
// GET /api/products/category?name=xyz&page=1 OR ?id=uuid&page=1
router.get("/category", getProductsByCategoryHandler);

// GET /api/products/search?name= or /api/products/search?code=
router.get("/search", searchProductsHandler);

// POST /api/products/
// Allowed for ADMIN/STAFF for uploading a single product detail manually
router.post("/", createSingleProductHandler);

// GET /api/products/brands/:id?page=1
// Allowed for all roles
router.get("/brands/:id", getBrandsProductListHandler);

// Fuzzy Search GET /api/products/list?name=xyz&page=1&limit=20
// Fuzzy Search GET /api/products/list?product_id=uuid
// Allowed for all roles
router.get("/list", optionalAuthenticateToken, getProductListBySearchHandler);

// For creating a new variant of an existing product
// Allowed only for ADMIN & STAFF
// POST /api/products/:productId/variants
router.post("/:productId/variants", createVariantHandler);

// Allowed for all roles
// GET /api/products/overview?page=1&limit=20
router.get(
  "/overview",
  optionalAuthenticateToken,
  getProductOverviewPaginatedHandler
);

// Allowed for all roles
// GET /api/products/segment/list?id=uuid OR ?name=Patch-Fittings
router.get("/segment/list", getProductsBySegmentHandler);

// Allowed for all roles
// GET /api/products/:id
router.get("/:id", getProductDetailsByIdHandler);

// Variant overview (Admin / Staff)
// GET /api/products/variants/overview
router.get("/variants/overview", getVariantsOverviewPaginatedHandler);

/**
 * ADMIN / STAFF
 * Update product details
 * PUT: /api/products/:id
 */
router.put("/:id", updateProductHandler);

/**
 * ADMIN / STAFF
 * Soft delete product (mark all variants as DISCONTINUED)
 * PATCH: /api/products/:id/soft-delete
 */
router.patch("/:id/soft-delete", softDeleteProductHandler);

/**
 * ADMIN ONLY
 * Hard delete product (permanent deletion)
 * DELETE: /api/products/:id
 */
router.delete(
  "/:id",
  authenticateToken,
  requireRole("ADMIN"),
  hardDeleteProductHandler
);

module.exports = router;
