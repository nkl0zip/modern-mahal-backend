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
} = require("../../controllers/staff/product.controller");

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
// GET /api/products/category?name=xyz OR ?id=uuid
router.get("/category", getProductsByCategoryHandler);

// GET /api/products/search?name= or /api/products/search?code=
router.get("/search", searchProductsHandler);

// POST /api/products/
// Allowed for ADMIN/STAFF for uploading a single product detail manually
router.post("/", createSingleProductHandler);

// GET /api/products/brands/:id
// Allowed for all roles
router.get("/brands/:id", getBrandsProductListHandler);

// Fuzzy Search GET /api/products/list?name=xyz
// Fuzzy Search GET /api/products/list?product_id=uuid
// Allowed for all roles
router.get("/list", getProductListBySearchHandler);

// Allowed for all roles
// GET /api/products/:id
router.get("/:id", getProductDetailsByIdHandler);

module.exports = router;
