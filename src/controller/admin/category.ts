import { UnauthorizedError } from "../../Errors/";
import { SuccessResponse } from "../../utils/response";
import { Request, Response } from "express";
import { CategoryModel } from "../../models/schema/admin/category";
import { saveBase64Image } from "../../utils/handleImages";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/";
import { ProductModel } from "../../models/schema/admin/products";
import { ProductPriceModel, ProductPriceOptionModel } from "../../models/schema/admin/product_price";
import { Product_WarehouseModel } from "../../models/schema/admin/Product_Warehouse";
import { WarehouseModel } from "../../models/schema/admin/Warehouse";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import { ParamsDictionary } from "express-serve-static-core";
import { ParsedQs } from "qs";
import { deletePhotoFromServer } from "../../utils/deleteImage";


export const createcategory = async (req: Request, res: Response) => {
  const { name, ar_name, image, parentId, banner, Is_Online, is_featured, order } = req.body;
  
  if (!name) throw new BadRequest("Category name is required");
  
  const existingCategory = await CategoryModel.findOne({ name, parentId: parentId || null, isDeleted: { $ne: true } });
  if (existingCategory) throw new BadRequest("There Another Category Has The Same Name");

  let imageUrl = "", bannerUrl = "";
  if (image) {
    imageUrl = await saveBase64Image(image, Date.now().toString(), req, "category");
  }

  if (banner) {
    bannerUrl = await saveBase64Image(banner, Date.now().toString(), req, "category");
  }

  const category = await CategoryModel.create({
    name,
    ar_name,
    image: imageUrl,
    banner: bannerUrl,
    parentId: parentId && parentId !== "" ? parentId : undefined,  // 👈 لو فاضي يبقى undefined
    Is_Online: Is_Online !== undefined ? Is_Online : true,
    is_featured: is_featured !== undefined ? is_featured : false,
    order
  });
  
  SuccessResponse(res, { message: "Category created successfully", category });
};


export const getCategories = async (req: Request, res: Response) => {
  const categories = await CategoryModel.find({ isDeleted: { $ne: true } }).populate("parentId", "name").lean();
  
  // ✅ احسب العدد الفعلي لكل category للمنتجات غير المحذوفة
  const categoriesWithCorrectCount = await Promise.all(
    categories.map(async (cat: any) => {
      const actualProductCount = await ProductModel.countDocuments({ 
        categoryId: cat._id,
        isDeleted: { $ne: true }
      });
      
      return {
        ...cat,
        product_quantity: actualProductCount
      };
    })
  );
  
  const ParentCategories = categoriesWithCorrectCount;
  
  SuccessResponse(res, { 
    message: "get categories successfully", 
    categories: categoriesWithCorrectCount,
    ParentCategories 
  });
};

export const getCategoryById = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) throw new BadRequest("Category id is required");
  const category = await CategoryModel.findOne({ _id: id, isDeleted: { $ne: true } }).populate("parentId", "name");
  if (!category) throw new NotFound("Category not found");
  const Parent= category.parentId;
  SuccessResponse(res, { message: "get category successfully", category,Parent });
};

export const deleteCategory = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { force, permanent } = req.query;

  if (force === "true" || permanent === "true") {
    return forceDeleteCategory(req, res);
  }

  if (!id) throw new BadRequest("Category id is required");

  if (!mongoose.Types.ObjectId.isValid(id)) throw new BadRequest("Invalid category id");

  const category = await CategoryModel.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!category) throw new NotFound("Category not found");

  const now = new Date();

  const softDeleteCategoryAndChildren = async (categoryId: string) => {
    // Soft delete products belonging to this category
    await ProductModel.updateMany(
      { categoryId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: now } }
    );

    const children = await CategoryModel.find({ parentId: categoryId, isDeleted: { $ne: true } });

    for (const child of children) {
      await softDeleteCategoryAndChildren(child._id.toString());
    }

    await CategoryModel.findByIdAndUpdate(categoryId, {
      $set: { isDeleted: true, deletedAt: now }
    });
  };

  await softDeleteCategoryAndChildren(id);

  SuccessResponse(res, { message: "Category and related items moved to trash successfully" });
};

export const forceDeleteCategory = async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id) throw new BadRequest("Category id is required");

  if (!mongoose.Types.ObjectId.isValid(id)) throw new BadRequest("Invalid category id");

  const category = await CategoryModel.findById(id);
  if (!category) throw new NotFound("Category not found");

  const deleteCategoryAndChildren = async (categoryId: string) => {
    // Delete all products and their related data
    const products = await ProductModel.find({ categoryId });
    for (const prod of products) {
      const stocks = await Product_WarehouseModel.find({ productId: prod._id });
      for (const stock of stocks) {
        await WarehouseModel.findByIdAndUpdate(stock.warehouseId, {
          $inc: {
            stock_Quantity: -stock.quantity,
            number_of_products: -1,
          },
        });
      }
      await Product_WarehouseModel.deleteMany({ productId: prod._id });

      const prices = await ProductPriceModel.find({ productId: prod._id });
      const priceIds = prices.map((p) => p._id);
      await ProductPriceOptionModel.deleteMany({
        product_price_id: { $in: priceIds },
      });
      await ProductPriceModel.deleteMany({ productId: prod._id });

      if (prod.image) await deletePhotoFromServer(prod.image).catch(() => {});
      if (prod.gallery_product && Array.isArray(prod.gallery_product)) {
        for (const img of prod.gallery_product) {
          await deletePhotoFromServer(img).catch(() => {});
        }
      }

      await ProductModel.findByIdAndDelete(prod._id);
    }

    const children = await CategoryModel.find({ parentId: categoryId });

    for (const child of children) {
      await deleteCategoryAndChildren(child._id.toString());
    }

    const catDoc = await CategoryModel.findById(categoryId);
    if (catDoc?.image) await deletePhotoFromServer(catDoc.image).catch(() => {});
    if (catDoc?.banner) await deletePhotoFromServer(catDoc.banner).catch(() => {});

    await CategoryModel.findByIdAndDelete(categoryId);
  };

  await deleteCategoryAndChildren(id);

  SuccessResponse(res, { message: "Category and related data permanently deleted successfully" });
};

export const getTrashedCategories = async (req: Request, res: Response) => {
  const categories = await CategoryModel.find({ isDeleted: true })
    .populate("parentId", "name")
    .sort({ deletedAt: -1, updatedAt: -1 })
    .lean();

  const categoriesWithCorrectCount = await Promise.all(
    categories.map(async (cat: any) => {
      const actualProductCount = await ProductModel.countDocuments({ 
        categoryId: cat._id 
      });
      
      return {
        ...cat,
        product_quantity: actualProductCount
      };
    })
  );

  SuccessResponse(res, { 
    message: "Trashed categories retrieved successfully", 
    categories: categoriesWithCorrectCount 
  });
};

export const restoreCategory = async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id) throw new BadRequest("Category id is required");

  if (!mongoose.Types.ObjectId.isValid(id)) throw new BadRequest("Invalid category id");

  const category = await CategoryModel.findOne({ _id: id, isDeleted: true });
  if (!category) throw new NotFound("Trashed category not found");

  const restoreCategoryAndChildren = async (categoryId: string) => {
    await CategoryModel.findByIdAndUpdate(categoryId, {
      $set: { isDeleted: false, deletedAt: null }
    });

    await ProductModel.updateMany(
      { categoryId, isDeleted: true },
      { $set: { isDeleted: false, deletedAt: null } }
    );

    const children = await CategoryModel.find({ parentId: categoryId, isDeleted: true });
    for (const child of children) {
      await restoreCategoryAndChildren(child._id.toString());
    }
  };

  await restoreCategoryAndChildren(id);

  const restored = await CategoryModel.findById(id).populate("parentId", "name");
  SuccessResponse(res, { message: "Category and related items restored successfully", category: restored });
};

export const updateCategory = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) throw new BadRequest("Category id is required");

  const category = await CategoryModel.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!category) throw new NotFound("Category not found");

  const { name, ar_name, parentId, image, banner, Is_Online, is_featured, order } = req.body;

  if (name !== undefined) category.name = name;
  if (ar_name !== undefined) category.ar_name = ar_name;
  if (Is_Online !== undefined) category.Is_Online = Is_Online;
  if (is_featured !== undefined) (category as any).is_featured = is_featured;
  if (order !== undefined) category.order = order;
  
  if (parentId !== undefined) {
    category.parentId = parentId && parentId !== "" ? parentId : undefined;
  }
  if (image) {
    if (category.image) {
      await deletePhotoFromServer(category.image);
    }
    category.image = await saveBase64Image(
      image,
      Date.now().toString(),
      req,
      "category"
    );
  }
  if (banner) {
    if (category.banner) {
      await deletePhotoFromServer(category.banner);
    }
    category.banner = await saveBase64Image(
      banner,
      Date.now().toString(),
      req,
      "category"
    );
  }


  await category.save();

  SuccessResponse(res, { message: "Category updated successfully", category });
};


// controllers/admin/category.ts


export const importCategoriesFromExcel = async (req: Request, res: Response) => {
  if (!req.file) {
    throw new BadRequest("Excel file is required");
  }

  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = req.file.buffer.buffer.slice(
    req.file.buffer.byteOffset,
    req.file.buffer.byteOffset + req.file.buffer.byteLength
  ) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.getWorksheet(1);

  if (!worksheet) {
    throw new BadRequest("Invalid Excel file");
  }

  // اقرأ الـ headers عشان نعرف ترتيب الأعمدة
  const headers: string[] = [];
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber] = cell.value?.toString().trim().toLowerCase() || "";
  });

  // ابحث عن الأعمدة بالاسم
  const findColumn = (names: string[]): number => {
    for (const name of names) {
      const index = headers.findIndex(h => h === name.toLowerCase());
      if (index !== -1) return index;
    }
    return -1;
  };

  const cols = {
    name: findColumn(["name", "category name", "الاسم"]),
    ar_name: findColumn(["ar_name", "arabic name", "الاسم بالعربي"]),
    parent: findColumn(["parent", "parent category", "القسم الرئيسي"]),
    image: findColumn(["image", "photo", "الصورة"]),
    order: findColumn(["order", "ترتيب"]),
  };

  const categories: Array<{
    name: string;
    ar_name: string;
    parent: string;
    image: string;
    order: number;
  }> = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const getValue = (colIndex: number): string => {
      if (colIndex === -1) return "";
      return row.getCell(colIndex + 1).value?.toString().trim() || "";
    };

    const name = cols.name !== -1 ? getValue(cols.name) : row.getCell(1).value?.toString().trim() || "";
    const ar_name = cols.ar_name !== -1 ? getValue(cols.ar_name) : row.getCell(2).value?.toString().trim() || "";
    const parent = cols.parent !== -1 ? getValue(cols.parent) : row.getCell(3).value?.toString().trim() || "";
    const image = cols.image !== -1 ? getValue(cols.image) : row.getCell(4).value?.toString().trim() || "";
    const order = cols.order !== -1 ? parseInt(getValue(cols.order)) : 999;

    if (name) {
      categories.push({ name, ar_name: ar_name || name, parent, image, order });
    }
  });

  if (categories.length === 0) {
    throw new BadRequest("No valid categories found");
  }

  const results = {
    success: [] as string[],
    failed: [] as { name: string; reason: string }[],
    skipped: [] as { name: string; reason: string }[],
  };

  // خريطة الـ Categories الموجودة
  const categoryMap: { [key: string]: string } = {};
  const existingCategories = await CategoryModel.find({ isDeleted: { $ne: true } }).lean();
  existingCategories.forEach((cat: any) => {
    categoryMap[cat.name.toLowerCase()] = cat._id.toString();
  });

  // رتب الـ categories: الـ parents الأول
  const sortedCategories = [...categories].sort((a, b) => {
    if (!a.parent && b.parent) return -1;
    if (a.parent && !b.parent) return 1;
    return 0;
  });

  for (const cat of sortedCategories) {
    try {
      // لو موجود، skip
      if (categoryMap[cat.name.toLowerCase()]) {
        results.skipped.push({
          name: cat.name,
          reason: "Already exists",
        });
        continue;
      }

      // دور على الـ Parent
      let parentId = null;
      if (cat.parent) {
        parentId = categoryMap[cat.parent.toLowerCase()];
        if (!parentId) {
          results.failed.push({
            name: cat.name,
            reason: `Parent "${cat.parent}" not found`,
          });
          continue;
        }
      }

      // أضف الـ Category
      const newCategory = await CategoryModel.create({
        name: cat.name,
        ar_name: cat.ar_name,
        parentId: parentId || null,
        image: cat.image || "",
        order: cat.order,
      });

      categoryMap[cat.name.toLowerCase()] = newCategory._id.toString();
      results.success.push(cat.name);
    } catch (error: any) {
      results.failed.push({
        name: cat.name,
        reason: error.message || "Unknown error",
      });
    }
  }

  return SuccessResponse(res, {
    message: "Import completed",
    total: categories.length,
    success_count: results.success.length,
    failed_count: results.failed.length,
    skipped_count: results.skipped.length,
    success: results.success,
    failed: results.failed,
    skipped: results.skipped,
  });
};



export const deletemanycategories = async (req: Request, res: Response) => {
  const { ids, force, permanent } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new BadRequest("At least one category ID is required");
  }

  if (force === true || permanent === true) {
    for (const id of ids) {
      const category = await CategoryModel.findById(id);
      if (!category) continue;
      const products = await ProductModel.find({ categoryId: id });
      for (const prod of products) {
        const stocks = await Product_WarehouseModel.find({ productId: prod._id });
        for (const stock of stocks) {
          await WarehouseModel.findByIdAndUpdate(stock.warehouseId, {
            $inc: { number_of_products: -1, stock_Quantity: -stock.quantity },
          });
        }
        await Product_WarehouseModel.deleteMany({ productId: prod._id });
        const prices = await ProductPriceModel.find({ productId: prod._id });
        const priceIds = prices.map((p) => p._id);
        await ProductPriceOptionModel.deleteMany({ product_price_id: { $in: priceIds } });
        await ProductPriceModel.deleteMany({ productId: prod._id });
        if (prod.image) await deletePhotoFromServer(prod.image).catch(() => {});
        await ProductModel.findByIdAndDelete(prod._id);
      }
      if (category.image) await deletePhotoFromServer(category.image).catch(() => {});
      if (category.banner) await deletePhotoFromServer(category.banner).catch(() => {});
      await CategoryModel.findByIdAndDelete(id);
    }
    return SuccessResponse(res, { message: "Categories and their products permanently deleted successfully" });
  }

  // Soft delete
  const now = new Date();
  await ProductModel.updateMany(
    { categoryId: { $in: ids }, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: now } }
  );
  const categoriesResult = await CategoryModel.updateMany(
    { _id: { $in: ids }, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: now } }
  );

  SuccessResponse(res, { 
    message: "Categories moved to trash successfully",
    deletedCategories: categoriesResult.modifiedCount
  });
};