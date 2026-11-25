// src/controller/users/Shipping.ts
import { Request, Response } from "express";
import mongoose from "mongoose";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { ShippingSettingsModel } from "../../models/schema/admin/ShippingSettings";
import { BostaShipmentModel } from "../../models/schema/admin/BostaShipment";
import { UserModel } from "../../models/schema/admin/User";
import { getBostaCreds } from "../../utils/shipping/getBostaCreds";
import {
  applyBostaStatusUpdate,
  resolveBostaState,
  syncOrderFromBostaState,
} from "../../utils/shipping/bostaStatus";
import bostaService from "../../services/bosta.service";

// ═══════════════════════════════════════════════════════════
// Helper: Get superadmin's shipping settings
// ═══════════════════════════════════════════════════════════
const getSuperadminSettings = async () => {
  const superadminUser = await UserModel.findOne({ role: "superadmin" })
    .select("_id")
    .lean();

  if (!superadminUser) return null;

  const settings = await ShippingSettingsModel.findOne({
    superadminId: (superadminUser as any)._id,
  }).lean();

  return settings;
};

// ═══════════════════════════════════════════════════════════
// 💵 Helper: احسب الـ markup
// ═══════════════════════════════════════════════════════════
const calculateMarkup = (
  bostaCost: number,
  markupValue: number,
  markupType: "fixed" | "percentage",
): number => {
  if (!markupValue || markupValue <= 0) return 0;

  if (markupType === "percentage") {
    return Math.round(bostaCost * (markupValue / 100) * 100) / 100;
  }

  return Number(markupValue);
};

// ═══════════════════════════════════════════════════════════
// 🛒 GET ACTIVE SHIPPING METHOD (E-commerce)
// ═══════════════════════════════════════════════════════════
export const getActiveShippingMethod = async (_req: Request, res: Response) => {
  const settings = await getSuperadminSettings();

  const activeMethod = settings?.activeMethod || "self";

  const response: any = {
    activeMethod,
    selfEnabled: activeMethod === "self",
    bostaEnabled: activeMethod === "bosta",
  };

  if (activeMethod === "bosta") {
    response.bosta = {
      enabled: settings?.bosta?.enabled === true,
      citiesEndpoint: "/api/store/shipping/bosta/cities",
      districtsEndpoint: "/api/store/shipping/bosta/districts/:cityId",
      pricingEndpoint: "/api/store/shipping/bosta/pricing",
    };
  }

  SuccessResponse(res, {
    message: "Active shipping method fetched successfully",
    data: response,
  });
};

// ═══════════════════════════════════════════════════════════
// 🛒 GET BOSTA CITIES (E-commerce)
// ═══════════════════════════════════════════════════════════
export const getBostaCitiesForUser = async (_req: Request, res: Response) => {
  const settings = await getSuperadminSettings();

  if (!settings?.bosta?.enabled) {
    throw new BadRequest("Bosta is not enabled");
  }

  const creds = getBostaCreds(settings as any);
  const cities = await bostaService.getCities(creds);

  const simplifiedCities = cities.map((c: any) => ({
    _id: c._id,
    name: c.name,
    nameAr: c.nameAr || c.name,
  }));

  SuccessResponse(res, {
    message: "Bosta cities fetched successfully",
    count: simplifiedCities.length,
    cities: simplifiedCities,
  });
};

// ═══════════════════════════════════════════════════════════
// 🛒 GET BOSTA DISTRICTS (E-commerce)
// ═══════════════════════════════════════════════════════════
export const getBostaDistrictsForUser = async (req: Request, res: Response) => {
  const settings = await getSuperadminSettings();

  if (!settings?.bosta?.enabled) {
    throw new BadRequest("Bosta is not enabled");
  }

  const { cityId } = req.params;
  if (!cityId) throw new BadRequest("cityId is required");

  const creds = getBostaCreds(settings as any);
  const districts = await bostaService.getDistricts(creds, cityId);

  const simplifiedDistricts = districts.map((d: any) => ({
    districtId: d.districtId,
    districtName: d.districtName,
    districtOtherName: d.districtOtherName,
    zoneId: d.zoneId,
    zoneName: d.zoneName,
    zoneOtherName: d.zoneOtherName,
  }));

  SuccessResponse(res, {
    message: "Bosta districts fetched successfully",
    count: simplifiedDistricts.length,
    districts: simplifiedDistricts,
  });
};

// ═══════════════════════════════════════════════════════════
// 🆕 GET BOSTA PRICING (E-commerce — للعميل)
// العميل يدفع: bostaCost + markup
// ═══════════════════════════════════════════════════════════
export const getBostaPricingForUser = async (req: Request, res: Response) => {
  const settings = await getSuperadminSettings();
  if (!settings?.bosta?.enabled) throw new BadRequest("Bosta is not enabled");

  const { dropOffCity, size, type } = req.query as any;
  // ❌ شيلت cod من هنا

  if (!dropOffCity) throw new BadRequest("dropOffCity is required");

  const pickupCity = settings.bosta?.pickup?.city;
  if (!pickupCity) throw new BadRequest("Pickup not configured");

  const creds = getBostaCreds(settings as any);

  try {
    const pricing = await bostaService.getShipmentPricing(creds, {
      pickupCity,
      dropOffCity,
      size: size || settings.bosta?.defaults?.size || "Normal",
      type: type || "SEND",
      // ❌ مفيش cod
    });

    const bostaCost = Number(pricing?.total || 0);

    // 💵 Admin Markup
    const markupValue = Number(settings.bosta?.shippingMarkup || 0);
    const markupType = settings.bosta?.shippingMarkupType || "fixed";
    const markup =
      markupValue > 0
        ? markupType === "percentage"
          ? bostaCost * (markupValue / 100)
          : markupValue
        : 0;

    const shippingToCustomer = Math.round((bostaCost + markup) * 100) / 100;

    SuccessResponse(res, {
      message: "Bosta pricing calculated successfully",
      pickupCity,
      dropOffCity,
      pricing: {
        total: shippingToCustomer, // ← العميل يدفع ده
        bostaCost, // ← Bosta cost
        markup, // ← ربحك
        currency: pricing.currency,
        source: pricing.source,
      },
    });
  } catch (err: any) {
    throw new BadRequest(`Failed to calculate pricing: ${err.message}`);
  }
};

// ═══════════════════════════════════════════════════════════
// 🔔 BOSTA WEBHOOK CALLBACK (Public — No Auth)
// يستقبل تحديثات الحالة من بوسطة تلقائياً ويحدّث الشحنة والأوردر
// ═══════════════════════════════════════════════════════════
export const handleBostaWebhook = async (req: Request, res: Response) => {
  const payload = req.body || {};
  const {
    _id,
    deliveryId,
    trackingNumber,
    state,
    status,
    statusCode,
    businessReference,
  } = payload;

  const bostaDeliveryId = _id || deliveryId;
  if (!bostaDeliveryId && trackingNumber === undefined && !businessReference) {
    throw new BadRequest(
      "Missing shipment identifier (_id, trackingNumber, or businessReference)",
    );
  }

  const resolved = resolveBostaState({ state, status, statusCode });
  if (!resolved.bostaStatus && resolved.statusCode === null) {
    throw new BadRequest("Valid state or status is required");
  }

  // 1) Try exact shipment lookup by deliveryId or trackingNumber first
  const primaryOr: any[] = [];
  if (bostaDeliveryId) {
    primaryOr.push({ deliveryId: String(bostaDeliveryId) });
  }
  if (trackingNumber !== undefined && trackingNumber !== null && trackingNumber !== "") {
    primaryOr.push({ trackingNumber: String(trackingNumber) });
  }

  let shipment = primaryOr.length
    ? await BostaShipmentModel.findOne({ $or: primaryOr }).sort({ createdAt: -1 })
    : null;

  // 2) Fallback to businessReference (Order ID)
  if (!shipment && businessReference) {
    shipment = await BostaShipmentModel.findOne({
      relatedModel: "Order",
      relatedId: String(businessReference),
    }).sort({ createdAt: -1 });
  }

  if (shipment) {
    const result = await applyBostaStatusUpdate({
      shipment,
      bostaData: payload,
      source: "bosta",
      appendHistoryIfUnchanged: true,
    });

    return SuccessResponse(res, {
      message: "Bosta webhook processed successfully",
      updated: true,
      statusChanged: result.statusChanged,
      orderStatusChanged: result.orderStatusChanged,
      shipment: {
        _id: shipment._id,
        deliveryId: shipment.deliveryId,
        trackingNumber: shipment.trackingNumber,
        status: result.status,
        statusCode: result.statusCode,
        lastSyncAt: shipment.lastSyncAt,
      },
      order: result.order,
    });
  }

  // 3) If no BostaShipment record exists, still sync Order if businessReference matches an Order
  if (
    businessReference &&
    mongoose.Types.ObjectId.isValid(String(businessReference)) &&
    resolved.orderStatus
  ) {
    const orderResult = await syncOrderFromBostaState({
      orderId: String(businessReference),
      orderStatus: resolved.orderStatus,
      bostaStatus: resolved.bostaStatus || String(resolved.statusCode),
      statusCode: resolved.statusCode,
      bostaData: payload,
      source: "bosta",
    });

    if (orderResult.order) {
      return SuccessResponse(res, {
        message: "Bosta webhook processed and order updated",
        updated: true,
        orderStatusChanged: orderResult.orderStatusChanged,
        shipment: null,
        order: orderResult.order,
      });
    }
  }

  return SuccessResponse(res, {
    message: "Webhook received (no matching shipment or order found)",
    updated: false,
  });
};
