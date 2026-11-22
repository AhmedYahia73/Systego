import { Router } from "express";
import {
  createProduct,
  getProduct,
  getOneProduct,
  updateProduct,
  deleteProduct,
  forceDeleteProduct,
  getTrashedProducts,
  restoreProduct,
  generateBarcodeImageController,
  generateProductCode,
  getProductByCode,
  modelsforselect,
  importProductsFromExcel,
  getLowStockProducts,
  deletemanyproducts
} from "../../controller/admin/products";
import { validate } from "../../middlewares/validation";
import { createProductSchema, updateProductSchema } from "../../validation/admin/products";
import { catchAsync } from "../../utils/catchAsync";
import { authenticated } from "../../middlewares/authenticated";
import { authorizePermissions } from "../../middlewares/haspremission";
import { uploadExcelFile } from "../../utils/uploadFile";

const route = Router();
// ✅ Static routes أولاً
route.post(
  "/import",
  authorizePermissions("product", "Add"),
  uploadExcelFile().single("file"),
  catchAsync(importProductsFromExcel)
);
// إنشاء منتج
route.post("/", authorizePermissions("product", "Add"), validate(createProductSchema), catchAsync(createProduct));

// جلب جميع المنتجات
route.get("/", authorizePermissions("product", "View"), catchAsync(getProduct));
route.get("/low-stock", authorizePermissions("product", "View"), catchAsync(getLowStockProducts));
route.delete("/", authorizePermissions("product", "Delete"), catchAsync(deletemanyproducts)); 

// Trash list
route.get("/trash", authorizePermissions("product", "View"), catchAsync(getTrashedProducts));

// ✅ ضع المسارات الثابتة أولًا
route.get("/generate-code", authorizePermissions("product", "View"), catchAsync(generateProductCode));
route.get("/generate-barcode/:product_price_id", authorizePermissions("product", "View"), catchAsync(generateBarcodeImageController));
route.get("/select", authorizePermissions("product", "View"), catchAsync(modelsforselect));
route.post("/code", authorizePermissions("product", "View"), catchAsync(getProductByCode));

// بعد كده المسارات اللي فيها :id
route.post("/:id/restore", authorizePermissions("product", "Edit"), catchAsync(restoreProduct));
route.delete("/:id/force", authorizePermissions("product", "Delete"), catchAsync(forceDeleteProduct));
route.get("/:id", authorizePermissions("product", "View"), catchAsync(getOneProduct));
route.put("/:id", authorizePermissions("product", "Edit"), validate(updateProductSchema), catchAsync(updateProduct));
route.delete("/:id", authorizePermissions("product", "Delete"), catchAsync(deleteProduct));

export default route;
