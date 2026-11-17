import { Router } from "express";
import {
  createTaxes,
  getTaxesById,
  getTaxes,
  updateTaxes,
  deleteTaxes,
  getTaxesSelection,
  assignTaxToProducts,
} from "../../controller/admin/Taxes";
import { validate } from "../../middlewares/validation";
import {
  createTaxesSchema,
  updateTaxesSchema,
  assignTaxToProductsSchema,
} from "../../validation/admin/Taxes";
import { catchAsync } from "../../utils/catchAsync";
import { authorizePermissions } from "../../middlewares/haspremission";

const route = Router();

route.get("/selection", authorizePermissions("Taxes", "View"), catchAsync(getTaxesSelection));
route.put("/assign-products", authorizePermissions("Taxes", "Edit"), validate(assignTaxToProductsSchema), catchAsync(assignTaxToProducts));
route.post("/assign-products", authorizePermissions("Taxes", "Edit"), validate(assignTaxToProductsSchema), catchAsync(assignTaxToProducts));

route.post("/", authorizePermissions("Taxes", "Add"), validate(createTaxesSchema), catchAsync(createTaxes));
route.get("/", authorizePermissions("Taxes", "View"), catchAsync(getTaxes));
route.get("/:id", authorizePermissions("Taxes", "View"), catchAsync(getTaxesById));
route.put("/:id", authorizePermissions("Taxes", "Edit"), validate(updateTaxesSchema), catchAsync(updateTaxes));
route.delete("/:id", authorizePermissions("Taxes", "Delete"), catchAsync(deleteTaxes));

export default route;


