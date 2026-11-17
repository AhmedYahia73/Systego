// src/utils/buildProductsWithVariations.ts

import { ProductModel } from "../models/schema/admin/products";
import { ProductPriceModel, ProductPriceOptionModel } from "../models/schema/admin/product_price";
import { VariationModel } from "../models/schema/admin/Variation";
import { Product_WarehouseModel } from "../models/schema/admin/Product_Warehouse";
interface BuildProductsOptions {
  filter?: any;
  warehouseId?: string;
}

export async function buildProductsWithVariations(options: BuildProductsOptions = {}) {
  const { filter = {}, warehouseId } = options;

  let productFilter = { ...filter };

  // ✅ لو فيه warehouseId، هات بس المنتجات الموجودة في المخزن
  let warehouseProductsMap: Map<string, number> = new Map();

  if (warehouseId) {
    const warehouseProducts = await Product_WarehouseModel.find({
      warehouseId: warehouseId,
      quantity: { $gt: 0 },
    }).select("productId quantity");

    // Map للوصول السريع للكمية
    warehouseProducts.forEach((wp) => {
      warehouseProductsMap.set(wp.productId.toString(), wp.quantity ?? 0);
    });

    const productIds = warehouseProducts.map((wp) => wp.productId);
    productFilter._id = { $in: productIds };
  }

  // 1️⃣ المنتجات حسب الفلتر
  const products = await ProductModel.find(productFilter)
    .populate("categoryId")
    .populate("brandId")
    .populate("taxesId")
    .lean();

  // 2️⃣ كل الـ Variations مرة واحدة
  const variations = await VariationModel.find().lean();

  // 3️⃣ نحضّر الـ products بالـ prices + options
  const formattedProducts = await Promise.all(
    products.map(async (product) => {
      // أسعار المنتج (ProductPrice)
      const prices = await ProductPriceModel.find({ productId: product._id }).lean();

      const formattedPrices = await Promise.all(
        prices.map(async (price) => {
          // options لكل price
          const options = await ProductPriceOptionModel.find({
            product_price_id: price._id,
          })
            .populate({
              path: "option_id",
              select: "_id name variationId",
            })
            .lean();

          // نجمع الـ options حسب الـ variation (Color, Size, ...)
          const groupedOptions: Record<string, any[]> = {};

          for (const po of options) {
            const option = po.option_id as any;
            if (!option?._id) continue;

            const variation = variations.find(
              (v) => v._id.toString() === option.variationId?.toString()
            );

            if (variation) {
              if (!groupedOptions[variation.name]) {
                groupedOptions[variation.name] = [];
              }
              groupedOptions[variation.name].push(option);
            }
          }

          const variationsArray = Object.keys(groupedOptions).map((varName) => ({
            name: varName,
            options: groupedOptions[varName],
          }));

          return {
            ...price,
            variations: variationsArray,
          };
        })
      );

      // ✅ الكمية من المخزن لو موجود warehouseId
      const quantity = warehouseId
        ? warehouseProductsMap.get(product._id.toString()) ?? 0
        : product.quantity;

      return {
        ...product,
        quantity, // ✅ الكمية الصحيحة
        prices: formattedPrices,
      };
    })
  );

  return formattedProducts;
}

export const roundCurrency = (val: number): number =>
  Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100;

export interface DiscountCheckOptions {
  applyIn?: string; // "POS" | "E-commerce"
  warehouseId?: string | any;
}

export function isDiscountApplicable(
  discount: any,
  options: DiscountCheckOptions = {}
): boolean {
  if (!discount || discount.status !== true) return false;

  // Check applyIn
  if (options.applyIn && discount.applyIn && discount.applyIn !== options.applyIn) {
    return false;
  }

  // Check warehouses
  if (discount.all_warehouses === true) {
    return true;
  }

  if (options.warehouseId && Array.isArray(discount.warehouse_ids)) {
    const wIdStr = options.warehouseId.toString();
    return discount.warehouse_ids.some(
      (w: any) => (w?._id ? w._id.toString() : w?.toString()) === wIdStr
    );
  }

  if (!options.warehouseId) {
    return discount.all_warehouses === true;
  }

  return false;
}

export interface PricingResult {
  taxId: {
    _id: any;
    name: string;
    ar_name: string;
    amount: number;
    type: "percentage" | "fixed";
  } | null;
  taxesId: {
    _id: any;
    name: string;
    ar_name: string;
    amount: number;
    type: "percentage" | "fixed";
  } | null;
  discountId: {
    _id: any;
    name: string;
    ar_name: string;
    amount: number;
    type: "percentage" | "fixed";
  } | null;
  tax: number;
  discount: number;
  final_price: number;
}

export function calculateProductPricing(params: {
  basePrice?: number | null;
  taxDoc: any;
  discountDoc: any;
  hasVariations: boolean;
  isOption?: boolean;
  warehouseId?: string | any;
  applyIn?: string;
}): PricingResult {
  const basePrice = roundCurrency(Number(params.basePrice) || 0);

  // 1. Tax check: status must be true
  const taxDoc = params.taxDoc;
  const isTaxActive = Boolean(taxDoc && taxDoc.status === true);
  const activeTax = isTaxActive
    ? {
        _id: taxDoc._id,
        name: taxDoc.name,
        ar_name: taxDoc.ar_name,
        amount: Number(taxDoc.amount) || 0,
        type: (taxDoc.type || "percentage") as "percentage" | "fixed",
      }
    : null;

  // 2. Discount check: status, applyIn, all_warehouses, warehouse_ids
  const discountDoc = params.discountDoc;
  const isDiscountActive = isDiscountApplicable(discountDoc, {
    applyIn: params.applyIn,
    warehouseId: params.warehouseId,
  });
  const activeDiscount = isDiscountActive
    ? {
        _id: discountDoc._id,
        name: discountDoc.name,
        ar_name: discountDoc.ar_name,
        amount: Number(discountDoc.amount) || 0,
        type: (discountDoc.type || "fixed") as "percentage" | "fixed",
      }
    : null;

  // 3. Tax value
  // If percentage: add based on basePrice at product & options
  // If fixed: add to product without variations only (so it doesn't get added twice)
  let taxValue = 0;
  if (activeTax) {
    if (activeTax.type === "percentage") {
      const rate = activeTax.amount > 1 ? activeTax.amount / 100 : activeTax.amount;
      taxValue = basePrice * rate;
    } else if (activeTax.type === "fixed") {
      if (!params.hasVariations && !params.isOption) {
        taxValue = activeTax.amount;
      } else {
        taxValue = 0;
      }
    }
  }
  taxValue = roundCurrency(taxValue);
  const priceAfterTax = roundCurrency(basePrice + taxValue);

  // 4. Discount value
  // Same logic as tax, but as deduction, and calculated on price after tax
  let discountValue = 0;
  if (activeDiscount) {
    if (activeDiscount.type === "percentage") {
      const rate = activeDiscount.amount > 1 ? activeDiscount.amount / 100 : activeDiscount.amount;
      discountValue = priceAfterTax * rate;
    } else if (activeDiscount.type === "fixed") {
      if (!params.hasVariations && !params.isOption) {
        discountValue = Math.min(priceAfterTax, activeDiscount.amount);
      } else {
        discountValue = 0;
      }
    }
  }
  discountValue = roundCurrency(discountValue);

  // 5. Final price: price + tax - discount
  const finalPrice = roundCurrency(Math.max(0, basePrice + taxValue - discountValue));

  return {
    taxId: activeTax,
    taxesId: activeTax,
    discountId: activeDiscount,
    tax: taxValue,
    discount: discountValue,
    final_price: finalPrice,
  };
}

export function calculateLineItemPricing(params: {
  basePrice?: number | null;
  hasVariations: boolean;
  taxRate?: number;
  taxType?: "percentage" | "fixed";
  discountRate?: number;
  discountType?: "percentage" | "fixed";
}) {
  const basePrice = roundCurrency(Number(params.basePrice) || 0);
  const taxRate = Number(params.taxRate) || 0;
  const taxType = params.taxType || "percentage";
  const discountRate = Number(params.discountRate) || 0;
  const discountType = params.discountType || "fixed";

  let unitTax = 0;
  if (taxRate > 0) {
    if (taxType === "percentage") {
      const rate = taxRate > 1 ? taxRate / 100 : taxRate;
      unitTax = basePrice * rate;
    } else if (taxType === "fixed") {
      if (!params.hasVariations) {
        unitTax = taxRate;
      } else {
        unitTax = 0;
      }
    }
  }
  unitTax = roundCurrency(unitTax);
  const priceAfterTax = roundCurrency(basePrice + unitTax);

  let unitDiscount = 0;
  if (discountRate > 0) {
    if (discountType === "percentage") {
      const rate = discountRate > 1 ? discountRate / 100 : discountRate;
      unitDiscount = priceAfterTax * rate;
    } else if (discountType === "fixed") {
      if (!params.hasVariations) {
        unitDiscount = Math.min(priceAfterTax, discountRate);
      } else {
        unitDiscount = 0;
      }
    }
  }
  unitDiscount = roundCurrency(unitDiscount);

  const finalPrice = roundCurrency(Math.max(0, basePrice + unitTax - unitDiscount));

  return {
    unitTax,
    priceAfterTax,
    unitDiscount,
    finalPrice,
  };
}

