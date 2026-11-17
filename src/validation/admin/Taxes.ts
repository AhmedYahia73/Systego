import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const createTaxesSchema = Joi.object({
  name: Joi.string().max(100).required(),
  ar_name: Joi.string().max(100).required(),
  status: Joi.boolean().optional().default(true),
  amount: Joi.number().min(0).required(),
  type: Joi.string().valid("percentage", "fixed").required(),
});

export const updateTaxesSchema = Joi.object({
  name: Joi.string().max(100).optional(),
  ar_name: Joi.string().max(100).optional(),
  status: Joi.boolean().optional(),
  amount: Joi.number().min(0).optional(),
  type: Joi.string().valid("percentage", "fixed").optional(),
});

export const assignTaxToProductsSchema = Joi.object({
  taxId: objectId.required().messages({
    "any.required": "taxId is required",
    "string.length": "taxId must be a valid 24-character hexadecimal ObjectId",
    "string.hex": "taxId must be a valid hexadecimal string",
  }),
  product_ids: Joi.array()
    .items(
      objectId.messages({
        "string.length": "Each product_id must be a valid 24-character hexadecimal ObjectId",
        "string.hex": "Each product_id must be a valid hexadecimal string",
      })
    )
    .min(1)
    .required()
    .messages({
      "any.required": "product_ids is required",
      "array.base": "product_ids must be an array",
      "array.min": "product_ids must contain at least one product ID",
    }),
});
