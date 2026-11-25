# توثيق تعديلات Bosta Shipping Webhook وتصحيح الحالات

ملخص التعديلات المنفذة لربط بوسطة (Bosta) بشكل صحيح:
1. إضافة **Webhook Callback API** عام (بدون Auth) في `src/controller/users/shipping.ts` لاستقبال تحديثات بوسطة تلقائيًا وتحديث حالة الشحنة والطلب.
2. إنشاء مرجع موحّد لحالات بوسطة في `src/utils/shipping/bostaStatus.ts`.
3. تصحيح قيم وخرائط الحالات في `src/controller/admin/Shipping.ts` (وتوافقها في `src/controller/admin/onlineOrders.ts`).

---

## جدول حالات بوسطة الرسمي المعتمد (`bostaStatus.ts`)

| `state` (Code) | الحالة في بوسطة (`status`) | حالة الطلب في Systego (`Order.status`) | ملاحظات |
|---|---|---|---|
| `10` | `Pickup requested` | `processing` | تم إنشاء الطلب في بوسطة |
| `11` | `Waiting for route` | `processing` | بانتظار التعيين على مسار |
| `20` | `Route Assigned` | `processing` | تم تعيين مندوب/مسار |
| `21` | `Picked up from business` | `processing` | تم الاستلام من التاجر |
| `22` | `Picking up from consignee` | `processing` | جاري الاستلام من العميل |
| `23` | `Picked up from consignee` | `out_for_delivery` | تم الاستلام من العميل |
| `24` | `Received at warehouse` | `processing` | تم الاستلام في مخزن بوسطة |
| `25` | `Fulfilled` | `processing` | تم التجهيز |
| `30` | `In transit` | `out_for_delivery` | قيد النقل بين الفروع |
| `40` | `Picking up` | `out_for_delivery` | المندوب في طريقه للتحصيل/الاستلام |
| `41` | `Picked up` | `out_for_delivery` | خرج مع المندوب للتوصيل |
| `45` | `Delivered` | `delivered` | تم التسليم للعميل |
| `46` | `Returned to business` | `returned` | رجع للتاجر |
| `47` | `Exception` | `failed_to_deliver` | فشل مؤقت / استثناء (مع `exceptionReason` و `exceptionCode`) |
| `48` | `Terminated` | `canceled` | تم الإنهاء |
| `49` | `Canceled` | `canceled` | ملغي |
| `100` | `PendingPickup` | `pending` | في انتظار الاستلام |
| `101` | `Lost` | `failed_to_deliver` | مفقود |
| `102` | `Damaged` | `failed_to_deliver` | تالف |
| `103` | `Investigation` | `processing` | قيد المراجعة |
| `104` | `Awaiting your action` | `failed_to_deliver` | بانتظار إجراء من التاجر |
| `105` | `Archived` | `canceled` | مؤرشف |

---

## 1) Bosta Webhook Callback (Public — بدون Auth)

### الشرح
Endpoint عام تستدعيه بوسطة تلقائيًا بـ `POST` عند أي تغيير في حالة الشحنة (يتم إعداده في لوحة تحكم بوسطة أو في `bosta.webhookUrl`).
يقوم بالآتي:
1. يبحث عن الشحنة في `BostaShipmentModel` عبر `deliveryId` (`_id`) أو `trackingNumber` أولًا، وإذا لم يجد يبحث عبر `businessReference` (`Order._id`).
2. يحدّث الشحنة (`status`, `statusCode`, `lastSyncAt`, `lastTrackAt`, `rawResponse`) ويضيف سجلًا في `trackingHistory`.
3. يحدّث الطلب المرتبط (`Order.status`, `Order.statusDescription`, `Order.statusHistory` بمصدر `"bosta"`) بما يشمل سبب الاستثناء `exceptionReason` و `exceptionCode` وعدد المحاولات `numberOfAttempts` في حالة `47`.
4. إذا لم يوجد سجل `BostaShipment` محلي وكان `businessReference` يطابق `Order` موجود في قاعدة البيانات، يحدّث حالة الـ `Order` مباشرة.

### التغيير الذي تم
- **إضافة جديدة بالكامل:**
  - `src/controller/users/shipping.ts` (`handleBostaWebhook`)
  - `src/routes/users/shipping.ts` (`POST /bosta/webhook`)
  - `src/utils/shipping/bostaStatus.ts` (`resolveBostaState`, `applyBostaStatusUpdate`, `syncOrderFromBostaState`)

### Endpoint
```http
POST /api/store/shipping/bosta/webhook
```
الرابط الكامل للربط في بوسطة:
```text
https://bcknd.systego.net/api/store/shipping/bosta/webhook
```

- **المصادقة:** لا يوجد (Public — بدون Auth).

### Headers
| Header | مطلوب | الوصف |
|---|---|---|
| `Content-Type` | ✅ | `application/json` |
| `Accept` | ❌ | `application/json` |

### Params
#### Path Params
لا يوجد.

#### Query Params
لا يوجد.

### Body
يرسل بواسطة بوسطة عند تغيير حالة الشحنة (يدعم أيضًا `state` ككائن `{ code, value }` أو نص):
```json
{
  "_id": "bosta_delivery_id",
  "trackingNumber": 48089608,
  "state": 47,
  "type": "SEND",
  "cod": 350,
  "timeStamp": 1689252908261,
  "isConfirmedDelivery": false,
  "deliveryPromiseDate": "13-07-2023",
  "exceptionReason": "Customer is not answering",
  "exceptionCode": 101,
  "businessReference": "67b1c2d3e4f5678901234567",
  "numberOfAttempts": 1
}
```

| الحقل | النوع | مطلوب | الوصف |
|---|---|---|---|
| `_id` / `deliveryId` | `string` | ❌* | معرف الشحنة في بوسطة (*مطلوب أحد المعرّفات: `_id` أو `trackingNumber` أو `businessReference`). |
| `trackingNumber` | `number \| string` | ❌* | رقم التتبع في بوسطة. |
| `businessReference` | `string` | ❌* | معرف الطلب في Systego (`Order._id`). |
| `state` | `number \| string \| object` | ✅ | كود الحالة من بوسطة (مثل `24`, `45`, `46`, `47`, `49`) أو كائن `{ code, value }` (أو إرسال `status`). |
| `type` | `string \| number` | ❌ | نوع الشحنة (`SEND`, `EXCHANGE`, `CRP`, `RTO`, `CASH_COLLECTION`). |
| `cod` | `number` | ❌ | مبلغ الدفع عند الاستلام. |
| `exceptionReason` | `string` | ❌ | سبب الفشل عند `state: 47`. |
| `exceptionCode` | `number \| string` | ❌ | كود الاستثناء عند `state: 47`. |
| `numberOfAttempts` | `number` | ❌ | عدد محاولات التوصيل. |

### Responses

#### Success (`200 OK`) — عند العثور على الشحنة وتحديثها
```json
{
  "success": true,
  "data": {
    "message": "Bosta webhook processed successfully",
    "updated": true,
    "statusChanged": true,
    "orderStatusChanged": true,
    "shipment": {
      "_id": "67b1...",
      "deliveryId": "bosta_delivery_id",
      "trackingNumber": "48089608",
      "status": "Exception",
      "statusCode": 47,
      "lastSyncAt": "2026-11-25T09:40:00.000Z"
    },
    "order": {
      "_id": "67b1c2d3e4f5678901234567",
      "reference": "11254821",
      "status": "failed_to_deliver",
      "statusDescription": "Bosta status: Exception (47) — Reason: Customer is not answering [101] — Attempts: 1"
    }
  }
}
```

#### Success (`200 OK`) — عند عدم وجود شحنة مطابقة (مثل Webhook Test)
```json
{
  "success": true,
  "data": {
    "message": "Webhook received (no matching shipment or order found)",
    "updated": false
  }
}
```

#### Error (`400 Bad Request`)
- عند غياب المعرّفات: `"Missing shipment identifier (_id, trackingNumber, or businessReference)"`
- عند غياب الحالة أو عدم صلاحيتها: `"Valid state or status is required"`

---

## 2) تحديثات Admin Bosta APIs في `src/controller/admin/Shipping.ts`

جميع المسارات التالية تتبع `/api/admin/shipping` وتتطلب مصادقة الأدمن:
- **Headers المشتركة:**
  | Header | مطلوب | الوصف |
  |---|---|---|
  | `Authorization` | ✅ | `Bearer <admin_jwt_token>` |
  | `Accept` | ❌ | `application/json` |

---

### 2.1 Refresh Bosta Tracking

#### الشرح والتغيير الذي تم
- **المشكلة السابقة:**
  - كان يتحقق من `shipment.status === "Cancelled"` فقط ولا يعترف بـ `"Canceled"` أو `"Terminated"`.
  - كان يعتمد على `map` يدوي ناقص وأسماء غير دقيقة لبعض حالات بوسطة (مثل غياب `Received at warehouse`، `Route Assigned`، `Picking up`، `Returned to business`، `Exception`، `Canceled`، `Terminated`، وربط `"Picked up"` بـ `"processing"` بدلًا من `"out_for_delivery"`).
  - كان يحدّث `Order.status` عبر `findByIdAndUpdate` بدون تسجيل `statusHistory` أو `statusDescription`.
- **التعديل:** استخدام `CANCELLED_BOSTA_STATUSES` و `applyBostaStatusUpdate` لدعم كل أكواد وأسماء بوسطة الرسمية وتحديث سجل الشحنة وسجل حالات الطلب (`statusHistory`, `statusDescription`).

#### Endpoint
```http
POST /api/admin/shipping/bosta/shipments/:shipmentId/refresh
```
- **الصلاحية:** `authorizePermissions("zone", "Edit")`
- **Path Params:** `shipmentId` (`string`, مطلوب — معرف الشحنة في `BostaShipment`).
- **Query Params:** لا يوجد.
- **Body:** لا يوجد.

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "message": "✅ Tracking refreshed successfully",
    "shipment": {
      "_id": "67b1...",
      "trackingNumber": "48089608",
      "deliveryId": "bosta_delivery_id",
      "type": 10,
      "status": "Delivered",
      "statusCode": 45,
      "lastSyncAt": "2026-11-25T09:40:00.000Z",
      "lastTrackAt": "2026-11-25T09:40:00.000Z",
      "statusChanged": true,
      "orderStatusChanged": true,
      "historyCount": 3,
      "history": [],
      "rawResponse": {}
    },
    "order": {
      "_id": "67b1c2d3e4f5678901234567",
      "reference": "11254821",
      "status": "delivered",
      "statusDescription": "Bosta status: Delivered (45)"
    },
    "endpointUsed": "/deliveries/business/48089608"
  }
}
```

---

### 2.2 Sync Bosta Shipment

#### الشرح والتغيير الذي تم
- **المشكلة السابقة:** كان يحدّث `shipment.status` و `shipment.statusCode` فقط بدون إضافة سجل إلى `trackingHistory` وبدون تحديث حالة الطلب المرتبط (`Order`).
- **التعديل:** استخدام `CANCELLED_BOSTA_STATUSES` و `applyBostaStatusUpdate` بحيث تتم مزامنة الشحنة وسجل التتبع وحالة الطلب المرتبط معًا.

#### Endpoint
```http
POST /api/admin/shipping/bosta/shipments/:shipmentId/sync
```
- **الصلاحية:** `authorizePermissions("zone", "Edit")`
- **Path Params:** `shipmentId` (`string`, مطلوب).
- **Query Params:** لا يوجد.
- **Body:** لا يوجد.

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "message": "✅ Shipment synced successfully",
    "statusChanged": true,
    "orderStatusChanged": true,
    "shipment": { "...": "..." },
    "order": {
      "_id": "67b1c2d3e4f5678901234567",
      "reference": "11254821",
      "status": "out_for_delivery",
      "statusDescription": "Bosta status: Picked up (41)"
    }
  }
}
```

---

### 2.3 Cancel Bosta Shipment

#### الشرح والتغيير الذي تم
- **المشكلة السابقة:** كان يضع `shipment.status = "Cancelled"` فقط بدون `statusCode: 49` وبدون تحديث `trackingHistory` أو حالة الطلب المرتبط (`Order.status = "canceled"`).
- **التعديل:** التحقق عبر `CANCELLED_BOSTA_STATUSES`، حفظ `status: "Canceled"` و `statusCode: 49` وإضافتها إلى `trackingHistory`، ومزامنة الطلب المرتبط إلى `"canceled"` عبر `syncOrderFromBostaState`.

#### Endpoint
```http
DELETE /api/admin/shipping/bosta/shipments/:shipmentId
```
- **الصلاحية:** `authorizePermissions("zone", "Edit")`
- **Path Params:** `shipmentId` (`string`, مطلوب).
- **Query Params:** لا يوجد.
- **Body:** لا يوجد.

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "message": "✅ Shipment cancelled successfully",
    "shipment": {
      "_id": "67b1...",
      "status": "Canceled",
      "statusCode": 49
    }
  }
}
```

---

### 2.4 تعديلات مساندة في باقي Endpoints داخل `Shipping.ts` و `onlineOrders.ts`

| Endpoint | الدالة | التغيير الذي تم |
|---|---|---|
| `POST /api/admin/shipping/bosta/deliveries/from-order` | `createBostaDeliveryFromOrder` | تحليل `state` و `status` عند الإنشاء عبر `resolveBostaState` لدعم القيم الرقمية والكائنية. |
| `POST /api/admin/shipping/bosta/deliveries/bulk` | `bulkCreateBostaDeliveries` | تحليل `state` و `status` عبر `resolveBostaState` عند جلب تفاصيل الشحنة. |
| `POST /api/admin/shipping/bosta/deliveries/return` | `createBostaReturnDelivery` | تحليل `state` و `status` عبر `resolveBostaState` عند إنشاء شحنة المرتجع. |
| `GET /api/admin/shipping/bosta/pickups/pending` | `getPendingPickups` | استبعاد كل الحالات النهائية الفعلية لبوسطة (`TERMINAL_BOSTA_STATUSES` مثل `Canceled`, `Returned to business`, `Exception`, `Terminated`). |
| `POST /api/admin/shipping/bosta/pickups/daily` | `createDailyPickup` | استبعاد كل الحالات النهائية الفعلية لبوسطة (`TERMINAL_BOSTA_STATUSES`) قبل جدولة البيك أب اليومي. |
| `GET /api/admin/shipping/bosta/shipments/stats` | `getBostaShipmentsStats` | احتساب كل حالات الإلغاء (`Cancelled`, `Canceled`, `Terminated`) ضمن إحصائيات الملغاة. |
| `GET /api/admin/shipping/bosta/shipments/:shipmentId/label` | `getBostaLabel` | التحقق من الإلغاء عبر `CANCELLED_BOSTA_STATUSES` بدل `"Cancelled"` فقط. |
| `PATCH /api/admin/online-orders/:id/status` و `DELETE /api/admin/online-orders/:id` | `updateOnlineOrderStatus`, `deleteOnlineOrder` | استخدام `CANCELLED_BOSTA_STATUSES` ودعم `"Returned to business"` لتفادي محاولة تعديل أو إلغاء شحنة ملغاة أو مرتجعة مسبقًا. |
