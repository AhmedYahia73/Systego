import { Request, Response } from "express";
import mongoose from "mongoose";
import { TaxesModel } from "../../models/schema/admin/Taxes";
import { ProductModel } from "../../models/schema/admin/products";
import { saveBase64Image } from "../../utils/handleImages";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors";
import { SuccessResponse } from "../../utils/response";

export const createTaxes = async (req: Request, res: Response) => {
  const { name, ar_name, status,amount ,type } = req.body;
    if (!name || !amount || !type) {
        throw new BadRequest(" name, amount, type  are required");
    }
    const existingTax = await TaxesModel.findOne({ name });
    if (existingTax) throw new BadRequest("Tax already exists");
    const tax = await TaxesModel.create({ name, ar_name, status,amount ,type });
    SuccessResponse(res, { message: "Tax created successfully", tax });
};
export const getTaxes = async (req: Request, res: Response) => {
    const taxes = await TaxesModel.find();
    SuccessResponse(res, { message: "Get taxes successfully", taxes });
}

export const getTaxesById = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new BadRequest("Tax ID is required");
    const tax = await TaxesModel.findById(id);
    if (!tax) throw new NotFound("Tax not found");
    SuccessResponse(res, { message: "Get tax successfully", tax });
}

export const deleteTaxes = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new BadRequest("Tax ID is required");
    const tax = await TaxesModel.findByIdAndDelete(id);
    if (!tax) throw new NotFound("Tax not found");
    SuccessResponse(res, { message: "Tax deleted successfully" });
}

export const updateTaxes = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new BadRequest("Tax ID is required");
    const tax = await TaxesModel.findByIdAndUpdate(id, req.body, { new: true });
    if (!tax) throw new NotFound("Tax not found");
    SuccessResponse(res, { message: "Tax updated successfully", tax });
}

export const getTaxesSelection = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const [taxes, products] = await Promise.all([
    TaxesModel.find().select("_id name").lean(),
    ProductModel.find().select("_id name").lean(),
  ]);

  SuccessResponse(res, {
    message: "Selection data fetched successfully",
    taxes,
    products,
  });
};

export const assignTaxToProducts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { taxId, product_ids } = req.body;

  if (!taxId) {
    throw new BadRequest("taxId is required");
  }

  if (!mongoose.Types.ObjectId.isValid(taxId)) {
    throw new BadRequest("Invalid taxId");
  }

  if (!Array.isArray(product_ids) || product_ids.length === 0) {
    throw new BadRequest("product_ids must be a non-empty array");
  }

  for (const id of product_ids) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequest(`Invalid product id: ${id}`);
    }
  }

  const tax = await TaxesModel.findById(taxId);
  if (!tax) {
    throw new NotFound("Tax not found");
  }

  const uniqueProductIds = Array.from(new Set(product_ids));
  const existingProductsCount = await ProductModel.countDocuments({
    _id: { $in: uniqueProductIds },
  });

  if (existingProductsCount !== uniqueProductIds.length) {
    throw new BadRequest("One or more products were not found");
  }

  await ProductModel.updateMany(
    { _id: { $in: uniqueProductIds } },
    { $set: { taxesId: taxId } },
  );

  SuccessResponse(res, {
    message: "Products tax updated successfully",
    updatedCount: uniqueProductIds.length,
  });
};


