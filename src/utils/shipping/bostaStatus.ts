// src/utils/shipping/bostaStatus.ts
import { OrderModel } from "../../models/schema/users/Order";

export const CANCELLED_BOSTA_STATUSES = [
  "Cancelled",
  "Canceled",
  "Terminated",
];

export const TERMINAL_BOSTA_STATUSES = [
  "Delivered",
  "Cancelled",
  "Canceled",
  "Terminated",
  "Returned",
  "Returned to business",
  "Failed to deliver",
  "Exception",
  "Lost",
  "Damaged",
  "Archived",
];

/**
 * Official Bosta delivery state codes -> canonical Bosta status & Order status.
 */
export const BOSTA_STATE_CODE_MAP: Record<
  number,
  { bostaStatus: string; orderStatus: string }
> = {
  10: { bostaStatus: "Pickup requested", orderStatus: "processing" },
  11: { bostaStatus: "Waiting for route", orderStatus: "processing" },
  20: { bostaStatus: "Route Assigned", orderStatus: "processing" },
  21: { bostaStatus: "Picked up from business", orderStatus: "processing" },
  22: { bostaStatus: "Picking up from consignee", orderStatus: "processing" },
  23: { bostaStatus: "Picked up from consignee", orderStatus: "out_for_delivery" },
  24: { bostaStatus: "Received at warehouse", orderStatus: "processing" },
  25: { bostaStatus: "Fulfilled", orderStatus: "processing" },
  30: { bostaStatus: "In transit", orderStatus: "out_for_delivery" },
  40: { bostaStatus: "Picking up", orderStatus: "out_for_delivery" },
  41: { bostaStatus: "Picked up", orderStatus: "out_for_delivery" },
  45: { bostaStatus: "Delivered", orderStatus: "delivered" },
  46: { bostaStatus: "Returned to business", orderStatus: "returned" },
  47: { bostaStatus: "Exception", orderStatus: "failed_to_deliver" },
  48: { bostaStatus: "Terminated", orderStatus: "canceled" },
  49: { bostaStatus: "Canceled", orderStatus: "canceled" },
  100: { bostaStatus: "PendingPickup", orderStatus: "pending" },
  101: { bostaStatus: "Lost", orderStatus: "failed_to_deliver" },
  102: { bostaStatus: "Damaged", orderStatus: "failed_to_deliver" },
  103: { bostaStatus: "Investigation", orderStatus: "processing" },
  104: { bostaStatus: "Awaiting your action", orderStatus: "failed_to_deliver" },
  105: { bostaStatus: "Archived", orderStatus: "canceled" },
};

/**
 * Case-insensitive Bosta status string -> Order status mapping.
 */
export const BOSTA_STATUS_NAME_TO_ORDER_STATUS: Record<string, string> = {
  pendingpickup: "pending",
  new: "pending",
  "pickup requested": "processing",
  "pickup scheduled": "processing",
  "waiting for route": "processing",
  "route assigned": "processing",
  "picked up from business": "processing",
  "picking up from consignee": "processing",
  "received at warehouse": "processing",
  fulfilled: "processing",
  investigation: "processing",
  "in transit": "out_for_delivery",
  "in transit between hubs": "out_for_delivery",
  "picking up": "out_for_delivery",
  "picked up": "out_for_delivery",
  "picked up from consignee": "out_for_delivery",
  "out for delivery": "out_for_delivery",
  delivered: "delivered",
  returned: "returned",
  "returned to business": "returned",
  "failed to deliver": "failed_to_deliver",
  exception: "failed_to_deliver",
  lost: "failed_to_deliver",
  damaged: "failed_to_deliver",
  "awaiting your action": "failed_to_deliver",
  canceled: "canceled",
  cancelled: "canceled",
  terminated: "canceled",
  archived: "canceled",
};

/**
 * Resolves numeric or object Bosta state / string status into canonical fields.
 */
export const resolveBostaState = (input: {
  state?: any;
  status?: string | null;
  statusCode?: number | null;
}): {
  statusCode: number | null;
  bostaStatus: string | null;
  orderStatus: string | null;
} => {
  const { state, status, statusCode } = input || {};

  let code: number | null = null;
  let rawValue: string | null = null;

  if (typeof state === "number" && !Number.isNaN(state)) {
    code = state;
  } else if (typeof state === "string" && state.trim() !== "") {
    if (/^\d+$/.test(state.trim())) {
      code = Number(state.trim());
    } else {
      rawValue = state.trim();
    }
  } else if (state && typeof state === "object") {
    if (
      state.code !== undefined &&
      state.code !== null &&
      !Number.isNaN(Number(state.code))
    ) {
      code = Number(state.code);
    }
    if (typeof state.value === "string" && state.value.trim()) {
      rawValue = state.value.trim();
    }
  }

  if (
    code === null &&
    statusCode !== undefined &&
    statusCode !== null &&
    !Number.isNaN(Number(statusCode))
  ) {
    code = Number(statusCode);
  }

  if (!rawValue && typeof status === "string" && status.trim()) {
    rawValue = status.trim();
  }

  if (code !== null && BOSTA_STATE_CODE_MAP[code]) {
    const mapped = BOSTA_STATE_CODE_MAP[code];
    return {
      statusCode: code,
      bostaStatus: rawValue || mapped.bostaStatus,
      orderStatus: mapped.orderStatus,
    };
  }

  const orderStatus = rawValue
    ? BOSTA_STATUS_NAME_TO_ORDER_STATUS[rawValue.toLowerCase()] || null
    : null;

  return {
    statusCode: code,
    bostaStatus: rawValue,
    orderStatus,
  };
};

/**
 * Updates an Order document's status, description, and history from a Bosta state change.
 */
export const syncOrderFromBostaState = async (params: {
  orderId: string;
  orderStatus: string;
  bostaStatus: string;
  statusCode?: number | null;
  bostaData?: any;
  source?: "bosta" | "admin";
  updatedBy?: string | null;
}) => {
  const {
    orderId,
    orderStatus,
    bostaStatus,
    statusCode,
    bostaData,
    source = "bosta",
    updatedBy = null,
  } = params;

  const order = await OrderModel.findById(orderId);
  if (!order) return { order: null, orderStatusChanged: false };

  const prevOrderStatus = order.status;
  const exceptionReason = bostaData?.exceptionReason;
  const exceptionCode = bostaData?.exceptionCode;
  const attempts = bostaData?.numberOfAttempts;

  const descParts = [`Bosta status: ${bostaStatus}`];
  if (statusCode !== null && statusCode !== undefined) {
    descParts[0] += ` (${statusCode})`;
  }
  if (exceptionReason) {
    descParts.push(
      `Reason: ${exceptionReason}${exceptionCode ? ` [${exceptionCode}]` : ""}`,
    );
  }
  if (attempts !== undefined && attempts !== null) {
    descParts.push(`Attempts: ${attempts}`);
  }
  const description = descParts.join(" — ");

  const orderStatusChanged = prevOrderStatus !== orderStatus;
  if (orderStatusChanged || exceptionReason) {
    order.status = orderStatus;
    order.statusDescription = description;
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status: orderStatus,
      description,
      source,
      updatedBy: updatedBy || null,
      updatedAt: new Date(),
    } as any);
    await order.save();
  }

  return {
    orderStatusChanged,
    order: {
      _id: order._id,
      reference: order.reference,
      status: order.status,
      statusDescription: order.statusDescription,
    },
  };
};

/**
 * Applies a Bosta status payload to a BostaShipment record and its linked Order.
 */
export const applyBostaStatusUpdate = async (params: {
  shipment: any;
  bostaData: any;
  source?: "bosta" | "admin";
  updatedBy?: string | null;
  appendHistoryIfUnchanged?: boolean;
}) => {
  const {
    shipment,
    bostaData,
    source = "bosta",
    updatedBy = null,
    appendHistoryIfUnchanged = false,
  } = params;

  const resolved = resolveBostaState({
    state: bostaData?.state,
    status: bostaData?.status,
    statusCode: bostaData?.statusCode,
  });

  const newStatus = resolved.bostaStatus || shipment.status;
  const newStatusCode = resolved.statusCode ?? shipment.statusCode;

  const statusChanged =
    newStatus !== shipment.status || newStatusCode !== shipment.statusCode;

  const now = new Date();
  shipment.status = newStatus;
  shipment.statusCode = newStatusCode;
  shipment.lastSyncAt = now;
  shipment.lastTrackAt = now;
  shipment.rawResponse = bostaData;

  if (
    !shipment.trackingNumber &&
    (bostaData?.trackingNumber || bostaData?.tracking?.number)
  ) {
    shipment.trackingNumber = String(
      bostaData?.trackingNumber || bostaData?.tracking?.number,
    );
  }
  if (!shipment.deliveryId && (bostaData?.deliveryId || bostaData?._id)) {
    shipment.deliveryId = String(bostaData?.deliveryId || bostaData?._id);
  }
  if (bostaData?.labelUrl || bostaData?.label) {
    shipment.labelUrl = bostaData.labelUrl || bostaData.label;
  }

  if (statusChanged || appendHistoryIfUnchanged) {
    shipment.trackingHistory = shipment.trackingHistory || [];
    shipment.trackingHistory.push({
      status: newStatus,
      statusCode: newStatusCode,
      snapshotAt: now,
      data: bostaData,
    });
  }

  await shipment.save();

  let orderResult: { order: any; orderStatusChanged: boolean } = {
    order: null,
    orderStatusChanged: false,
  };

  if (
    shipment.relatedModel === "Order" &&
    shipment.relatedId &&
    resolved.orderStatus
  ) {
    orderResult = await syncOrderFromBostaState({
      orderId: String(shipment.relatedId),
      orderStatus: resolved.orderStatus,
      bostaStatus: newStatus || "",
      statusCode: newStatusCode,
      bostaData,
      source,
      updatedBy,
    });
  }

  return {
    statusChanged,
    orderStatusChanged: orderResult.orderStatusChanged,
    status: newStatus,
    statusCode: newStatusCode,
    orderStatus: resolved.orderStatus,
    order: orderResult.order,
  };
};
