const path = require("path");
const fs = require("fs");
const { parseExcel } = require("../../utils/excelParser");
const {
  findIdByName,
  createProduct,
  insertProductCategory,
  insertProductColor,
  insertOneToMany,
  getAllProductDetails,
  searchProducts,
  getBrandsProductList,
} = require("../../models/staff/product.model");

const uploadProductsFromExcel = async (req, res, next) => {
  try {
    const filePath = req.file.path;
    const rows = parseExcel(filePath);

    for (const row of rows) {
      // 1. Lookup for brand (skip row if brand missing)
      const brand_id = row["Brand"]
        ? await findIdByName("brands", row["Brand"])
        : null;
      if (!brand_id) continue;

      // 2. Create product
      const product = {
        name: row["Product Name"],
        brand_id,
        product_code: row["Product Code"],
        description: row["Description"],
        stock_quantity: parseInt(row["Stock Quantity"]) || 0,
        quantity_per_unit: parseInt(row["Quantity Per Unit"]) || null,
        price_per_unit: parseFloat(row["Price per unit"]) || null,
        quantity_bundle_max: parseInt(row["Quantity Bundle Max"]) || null,
        price_bundle_max: parseFloat(row["Price Bundle Max"]) || null,
        quantity_bundle_ultra: parseInt(row["Quantity Bundle Ultra"]) || null,
        price_bundle_ultra: parseFloat(row["Price Bundle Ultra"]) || null,
        weight_capacity: parseFloat(row["Weight Capacity"]) || null,
        product_dimension: row["Product Dimension"],
        warranty: row["Warranty"],
      };

      const createdProduct = await createProduct(product);

      // 3. Product-Category (join)
      const parseArr = (val) =>
        val
          ? val
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      const categoryNames = parseArr(row["Product Category"]);
      const categoryIds = [];
      for (const cat of categoryNames) {
        const catId = await findIdByName("categories", cat);
        if (catId) categoryIds.push(catId);
      }
      await insertProductCategory(createdProduct.id, categoryIds);

      // 4. Product-Color (join)
      const colorNames = parseArr(row["Colour"]);
      const colorIds = [];
      for (const color of colorNames) {
        const colorId = await findIdByName("colors", color);
        if (colorId) colorIds.push(colorId);
      }
      await insertProductColor(createdProduct.id, colorIds);

      // 5. Highlights (one-to-many)
      const highlightsArr = parseArr(row["Highlights"]);
      await insertOneToMany(
        "highlights",
        createdProduct.id,
        highlightsArr,
        "text"
      );

      // 6. Alloys (one-to-many)
      const alloysArr = parseArr(row["Alloy"]);
      await insertOneToMany("alloys", createdProduct.id, alloysArr, "name");

      // 7. Usability (one-to-many)
      const usabilityArr = parseArr(row["Usability"]);
      await insertOneToMany(
        "usability",
        createdProduct.id,
        usabilityArr,
        "name"
      );

      // 8. In Box Content (one-to-many)
      const inBoxArr = parseArr(row["In Box Content"]);
      await insertOneToMany(
        "in_box_content",
        createdProduct.id,
        inBoxArr,
        "name"
      );

      // 9. Tags (one-to-many)
      const tagsArr = parseArr(row["Tags"]);
      await insertOneToMany("tags", createdProduct.id, tagsArr, "name");
    }

    fs.unlinkSync(filePath);
    res.json({ message: "Products uploaded and imported successfully." });
  } catch (err) {
    next(err);
  }
};

// For uploading a single product details
const createSingleProductHandler = async (req, res, next) => {
  try {
    const {
      name,
      brand,
      product_code,
      product_category,
      description,
      colour,
      highlights,
      stock_quantity,
      quantity_per_unit,
      price_per_unit,
      quantity_bundle_max,
      price_bundle_max,
      quantity_bundle_ultra,
      price_bundle_ultra,
      alloy,
      weight_capacity,
      product_dimension,
      usability,
      in_box_content,
      warranty,
      tags,
    } = req.body;

    // 1. Brand Lookup
    const brand_id = brand ? await findIdByName("brands", brand) : null;
    if (!brand_id) {
      return res
        .status(400)
        .json({ message: "Brand not found. Please provide a valid brand." });
    }

    // 2. Product Creation
    const product = {
      name,
      brand_id,
      product_code,
      description,
      stock_quantity: parseInt(stock_quantity) || 0,
      quantity_per_unit: parseInt(quantity_per_unit) || null,
      price_per_unit: parseFloat(price_per_unit) || null,
      quantity_bundle_max: parseInt(quantity_bundle_max) || null,
      price_bundle_max: parseFloat(price_bundle_max) || null,
      quantity_bundle_ultra: parseInt(quantity_bundle_ultra) || null,
      price_bundle_ultra: parseFloat(price_bundle_ultra) || null,
      weight_capacity: parseFloat(weight_capacity) || null,
      product_dimension,
      warranty,
    };

    const createdProduct = await createProduct(product);

    // 3. Product-Category (join)
    const parseArr = (val) =>
      Array.isArray(val)
        ? val
        : val
        ? val
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    const categoryNames = parseArr(product_category);
    const categoryIds = [];
    for (const cat of categoryNames) {
      const catId = await findIdByName("categories", cat);
      if (catId) categoryIds.push(catId);
    }
    await insertProductCategory(createdProduct.id, categoryIds);

    // 4. Product-Color (join)
    const colorNames = parseArr(colour);
    const colorIds = [];
    for (const color of colorNames) {
      const colorId = await findIdByName("colors", color);
      if (colorId) colorIds.push(colorId);
    }
    await insertProductColor(createdProduct.id, colorIds);

    // 5. Highlights (one-to-many)
    await insertOneToMany(
      "highlights",
      createdProduct.id,
      parseArr(highlights),
      "text"
    );

    // 6. Alloys (one-to-many)
    await insertOneToMany("alloys", createdProduct.id, parseArr(alloy), "name");

    // 7. Usability (one-to-many)
    await insertOneToMany(
      "usability",
      createdProduct.id,
      parseArr(usability),
      "name"
    );

    // 8. In Box Content (one-to-many)
    await insertOneToMany(
      "in_box_content",
      createdProduct.id,
      parseArr(in_box_content),
      "name"
    );

    // 9. Tags (one-to-many)
    await insertOneToMany("tags", createdProduct.id, parseArr(tags), "name");

    res.status(201).json({
      message: "Product created successfully.",
      product: {
        ...createdProduct,
        brand,
        product_category,
        colour,
        highlights,
        alloy,
        usability,
        in_box_content,
        tags,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/products
const getAllProductsHandler = async (req, res, next) => {
  try {
    const products = await getAllProductDetails();
    res.status(200).json({
      message: "Products fetched successfully.",
      products,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/products/search?name=... OR ?code=...
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

    res.status(200).json({
      message: "Products fetched successfully.",
      products,
    });
  } catch (err) {
    next(err);
  }
};

const getBrandsProductListHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id)
      return res.status(400).json({ message: "This Brand is not found" });

    const products = await getBrandsProductList(id);

    if (!products || products.length === 0) {
      return res
        .status(400)
        .json({ message: "No Products Found with this brand", products: [] });
    }

    res.status(200).json({
      message: "Sucessfully fetched Products",
      products,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  uploadProductsFromExcel,
  getAllProductsHandler,
  searchProductsHandler,
  createSingleProductHandler,
  getBrandsProductListHandler,
};
