import { Router } from "express";
import {
  getAllProducts,
  getProductById,
  getBestSellingProducts,
  getProductsByCategory,
  getGalleryByOptions,
} from "../../controller/users/products";
import { optionalAuthenticated } from "../../middlewares/optionalAuthenticated";

const productRoute = Router();

productRoute.post("/gallery", getGalleryByOptions);

productRoute.use(optionalAuthenticated);

productRoute.get("/best-sellers", getBestSellingProducts);
productRoute.get("/", getAllProducts);
productRoute.get("/category/:id", getProductsByCategory);
productRoute.get("/:id", getProductById);

export default productRoute;
