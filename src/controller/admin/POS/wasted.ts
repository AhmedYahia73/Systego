import { Request, Response } from "express";
import mongoose from "mongoose";
import { AppError, BadRequest } from "../../../Errors";
import { ProductModel } from "../../../models/schema/admin/products";
import { ProductPriceModel } from "../../../models/schema/admin/product_price";
import { Product_WarehouseModel } from "../../../models/schema/admin/Product_Warehouse";
import { WarehouseModel } from "../../../models/schema/admin/Warehouse";
import { WastedModel } from "../../../models/schema/admin/wasted";
import { SuccessResponse } from "../../../utils/response";

// ==================== Create Wasted Entry (Without stock decrement) ====================
export const createWasted = async (req: Request, res: Response) => {
  try {
    const {
      productId,
      productPriceId = null,
      warehouseId: bodyWarehouseId,
      quantity,
      reason,
      note,
    } = req.body;

    const jwtUser = req.user as any;
    const userId = jwtUser?.id || jwtUser?._id;
    const warehouseId = bodyWarehouseId || jwtUser?.warehouse_id;

    console.log("createWasted request body:", req.body);

    if (!productId || !warehouseId || quantity === undefined || quantity === null || !reason) {
      throw new BadRequest(
        "productId, warehouseId, quantity, and reason are required"
      );
    }

    const numQuantity = Number(quantity);
    if (isNaN(numQuantity) || numQuantity <= 0) {
      throw new BadRequest("quantity must be a valid number greater than 0");
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new BadRequest("Invalid productId");
    }

    if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
      throw new BadRequest("Invalid warehouseId");
    }

    const warehouse = await WarehouseModel.findById(warehouseId);
    if (!warehouse) {
      throw new BadRequest("Warehouse not found");
    }

    const product = await ProductModel.findById(productId);
    if (!product) {
      throw new BadRequest("Product not found");
    }

    // Normalize productPriceId
    let normalizedProductPriceId: string | null = null;
    if (productPriceId && productPriceId !== "null" && productPriceId !== "") {
      if (!mongoose.Types.ObjectId.isValid(productPriceId)) {
        throw new BadRequest("Invalid productPriceId");
      }
      normalizedProductPriceId = productPriceId.toString();
    }

    // Check variations
    const variations = await ProductPriceModel.find({ productId }).lean();
    const hasVariations = variations.length > 0;

    if (hasVariations && !normalizedProductPriceId) {
      throw new BadRequest("productPriceId is required for products with variations");
    }

    if (normalizedProductPriceId) {
      const variationExists = variations.some(
        (v: any) => v._id.toString() === normalizedProductPriceId
      );
      if (!variationExists) {
        throw new BadRequest("Product price (variation) not found for this product");
      }
    }

    // Calculate available stock matching GET /api/admin/product
    const stocks = await Product_WarehouseModel.find({
      productId,
      warehouseId,
    }).lean();

    let availableStock = 0;
    if (normalizedProductPriceId) {
      for (const s of stocks as any[]) {
        if (s.productPriceId && s.productPriceId.toString() === normalizedProductPriceId) {
          availableStock += (s.quantity || 0);
        }
      }
    } else {
      for (const s of stocks as any[]) {
        if (!s.productPriceId) {
          availableStock += (s.quantity || 0);
        }
      }
    }

    if (numQuantity > availableStock) {
      throw new BadRequest(
        `Quantity cannot exceed available stock. Available stock: ${availableStock}, requested: ${numQuantity}`
      );
    }

    // Create the Wasted record without deducting stock
    const wastedDoc = await WastedModel.create({
      productId,
      productPriceId: normalizedProductPriceId,
      warehouseId,
      quantity: numQuantity,
      reason,
      note,
      userId,
      isApproved: false,
    });

    SuccessResponse(res, { message: "Wasted entry created", wastedDoc });
  } catch (error: any) {
    console.error("createWasted error:", error);
    if (error instanceof AppError) {
      throw error;
    }
    throw new BadRequest(error.message || "Failed to create wasted entry");
  }
};
