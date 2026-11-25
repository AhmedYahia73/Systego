# توثيق دعم بيانات العميل للـ Guest Orders (`customer_name` & `customer_phone`)

هذا الملف يوثق التعديلات التي تمت لدعم إرسال وحفظ واسترجاع بيانات العميل (`customer_name` و `customer_phone`) عند إنشاء الطلب كـ **Guest** (بدون حساب عميل مسجل) أو كعميل مسجل، مع توحيد أسماء المفاتيح في الـ Schema والـ Request والـ Response بدون أي تكرار (Canonical Keys Only).

---

## 1. ملخص التعديلات (Summary of Changes)

| الملف | ما تم تعديله |
|---|---|
| `src/models/schema/users/Order.ts` | اعتماد الحقلين الموحدين `customer_name` و `customer_phone` في `orderSchema` بدلاً من `customerName` و `customerPhone`. |
| `src/validation/users/order.ts` | إضافة `customer_name` و `customer_phone` إلى `createOrderSchema` لقبولهما في الـ Checkout Request. |
| `src/controller/users/Order.ts` | - قراءة وحفظ `customer_name` و `customer_phone` في `createOrder` (مع fallback لبيانات `Customer` المسجل إن وجد).<br>- تمريرهما إلى **Paymob** و **Fawry** و **externalOrderSync**.<br>- إرجاعهما في استجابات جلب الطلبات (`getMyOrders`، `getOrderDetails`، `getOrderStatusByRef`). |
| `src/controller/admin/onlineOrders.ts` | - إرجاع `customer_name` و `customer_phone` في `getAllOnlineOrders` و `getOnlineOrderById` (مع fallback من بيانات `user` للطلبات القديمة/المسجلة).<br>- استخدام `order.customer_phone` و `order.customer_name` كـ `receiver` في `bulkCreateShipments` عند شحن طلبات الـ Guest عبر Bosta. |
| `src/controller/admin/POS/onlineOrders.ts` | إرجاع `customer_name` و `customer_phone` في `getAllOnlineOrders` و `getOnlineOrderById` الخاصة بـ POS. |
| `src/controller/public/onlineOrders.ts` | تحديث الحفظ والـ Serialization (`serializeOrder` و `createEcommerceOnlineOrder`) لاستخدام `customer_name` و `customer_phone` مباشرة من الـ Schema الموحدة. |

### تفاصيل الـ Schema (`OrderModel`)

```ts
// src/models/schema/users/Order.ts
customer_name: { type: String, trim: true, default: "" },
customer_phone: { type: String, trim: true, default: "" },
```

- **سلوك الحفظ عند الإنشاء (`createOrder`):**
  1. إذا كان المشتري **Guest** (لا يوجد `userId` / بدون `Authorization` token)، يكون الحقلان `customer_name` و `customer_phone` **إجباريين (Required)**، وإلا يرفض الطلب بـ `400 Bad Request` (`"customer_name is required for guest checkout"` / `"customer_phone is required for guest checkout"`).
  2. إذا كان المشتري عميلاً مسجلاً (`Authorization: Bearer <token>`)، يكونان **اختياريين**؛ وإن لم يُرسلا تُؤخذ القيم تلقائياً من سجل العميل (`customer.name` و `customer.phone_number`).
  3. في حالة الـ Guest يكون `user: null` وتُحفظ بيانات `customer_name` و `customer_phone` بعد عمل `trim()` مباشرة على الطلب.
- **سلوك الاسترجاع عند الجلب (Fetch):**
  - يتم إرجاع `customer_name` و `customer_phone` في كل استجابات الأوردر:
    - `customer_name = order.customer_name || order.user?.name || ""`
    - `customer_phone = order.customer_phone || order.user?.phone_number || order.user?.phone || ""`

---

## 2. توثيق الـ APIs

### 2.1 إنشاء طلب جديد (Checkout — Guest أو Customer)

```http
POST /api/store/order/checkout
```

- **المصادقة (Auth):** اختيارية (`optionalAuthenticated`).
  - للـ **Guest**: لا يُرسل `Authorization`، ويُرسل `x-session-id` في الـ Header لتحديد السلة.
  - للـ **Customer**: يُرسل `Authorization: Bearer <token>`.

#### Headers
| Header | مطلوب | الوصف |
|---|---|---|
| `Content-Type` | ✅ | `application/json` |
| `x-session-id` | ✅ (للـ Guest) | معرّف جلسة السلة الخاصة بالـ Guest (يقرأه الكنترولر من `req.headers["x-session-id"]`). |
| `Authorization` | ❌ (اختياري) | `Bearer <customer_jwt_token>` في حالة العميل المسجل. |
| `x-lang` / `x-language` | ❌ | `ar` أو `en` لتعريب الحقول (بديل عن query param `lang`). |

#### Query Parameters
| Parameter | مطلوب | القيم المتاحة | الوصف |
|---|---|---|---|
| `lang` (أو `language` / `locale`) | ❌ | `ar`, `en` | تحديد لغة الاستجابة (مثال: `?lang=ar`). |

#### Request Body
| الحقل | النوع | مطلوب | الوصف |
|---|---|---|---|
| `customer_name` | `string` | ✅ للـ Guest / ❌ للعميل المسجل | اسم العميل (إجباري عندما لا يوجد `Authorization` token، ويُعمل له `trim()`). |
| `customer_phone` | `string` | ✅ للـ Guest / ❌ للعميل المسجل | رقم هاتف العميل (إجباري عندما لا يوجد `Authorization` token، ويُعمل له `trim()`). |
| `orderType` | `string` | ❌ | `"delivery"` (الافتراضي) أو `"pickup"`. |
| `warehouseId` | `string` (ObjectId) | ✅ إذا `orderType = "pickup"` | معرّف المخزن (24 hex chars). |
| `shippingAddress` | `string \| object` | ✅ إذا `orderType = "delivery"` | إما ObjectId لعنوان محفوظ (للعميل المسجل)، أو Object بيانات العنوان (Self أو Bosta). |
| `paymentMethod` | `string` (ObjectId) | ✅ | معرّف وسيلة الدفع الفعّالة (24 hex chars). |
| `paymentType` | `string` | ❌ | `"full"` (الافتراضي) أو `"installment"`. |
| `installment` | `object` | ✅ إذا `paymentType = "installment"` | `{ months: number (1..60), down_payment?: number, notes?: string }`. |
| `proofImage` | `string` | ✅ للدفع اليدوي غير الكاش | صورة إثبات التحويل (Base64 / URL) إذا كان `requiresProof = true`. |
| `sessionId` | `string` | ❌ | متاح في الـ Validation Schema؛ ملاحظة: البحث عن السلة في الكنترولر يعتمد على هيدر `x-session-id`. |

**تفاصيل `shippingAddress` عند إرساله كـ Object:**
- حقول مشتركة: `street` (مطلوب)، `buildingNumber`، `floorNumber`، `apartmentNumber`، `uniqueIdentifier`.
- للشحن الداخلي (Self): `country`، `city`، `zone`.
- لشحن Bosta: `bostaCityId`، `bostaCityName`، `bostaZoneId`، `bostaZoneName`، `bostaDistrictId`، `bostaDistrictName`.
- *(يجب إرسال `city` أو `bostaCityId` على الأقل).*

**مثال Body (Guest Checkout):**
```json
{
  "orderType": "delivery",
  "customer_name": "أحمد محمد",
  "customer_phone": "01012345678",
  "paymentMethod": "67a1b2c3d4e5f67890123456",
  "paymentType": "full",
  "shippingAddress": {
    "street": "شارع التحرير",
    "buildingNumber": "12",
    "floorNumber": "3",
    "apartmentNumber": "5",
    "uniqueIdentifier": "بجوار المسجد",
    "city": "67a1b2c3d4e5f67890123411",
    "zone": "67a1b2c3d4e5f67890123422"
  }
}
```

#### Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "message": "Order created successfully",
    "order": {
      "_id": "67b1c2d3e4f5678901234567",
      "reference": "11254821",
      "user": null,
      "customer_name": "أحمد محمد",
      "customer_phone": "01012345678",
      "currency": "EGP",
      "orderType": "delivery",
      "warehouse": "67a1b2c3d4e5f67890123400",
      "cartItems": [
        {
          "product": "6afebc83783fcaf1c5e35591",
          "quantity": 1,
          "price": 500
        }
      ],
      "shippingAddress": {
        "details": "شارع التحرير",
        "city": "Cairo",
        "zone": "Dokki",
        "street": "شارع التحرير",
        "apartmentNumber": "5",
        "floorNumber": "3",
        "buildingNumber": "12",
        "uniqueIdentifier": "بجوار المسجد"
      },
      "shippingPrice": 50,
      "totalOrderPrice": 500,
      "totalPriceAfterDiscount": 550,
      "taxAmount": 0,
      "serviceFee": 0,
      "couponDiscount": 0,
      "paymentMethod": "67a1b2c3d4e5f67890123456",
      "paymentType": "full",
      "paymentGateway": "manual",
      "paymentStatus": "unpaid",
      "status": "pending",
      "shippingMethod": "self",
      "shipmentType": "self",
      "createdAt": "2026-11-25T07:25:00.000Z",
      "updatedAt": "2026-11-25T07:25:00.000Z"
    },
    "payment": null,
    "installment_plan": null
  }
}
```
> ملاحظة: في حالة الدفع الإلكتروني (Paymob / Geidea / Fawry)، يحتوي `payment` على بيانات الدفع و`iframeUrl`، ويتم استخدام `customer_name` و `customer_phone` في بيانات الفاتورة/العميل لبوابات Paymob و Fawry ومزامنة الطلب الخارجي `externalOrderSync`.

---

### 2.2 جلب تفاصيل طلب في المتجر (Storefront — Get Order Details)

```http
GET /api/store/order/:id
```

#### Headers
| Header | مطلوب | الوصف |
|---|---|---|
| `Authorization` | ❌ (اختياري) | `Bearer <customer_jwt_token>` (`optionalAuthenticated`) |
| `x-lang` / `x-language` | ❌ | `ar` أو `en` |

#### Path Parameters
| Parameter | مطلوب | الوصف |
|---|---|---|
| `id` | ✅ | MongoDB `_id` الخاص بالطلب. |

#### Query Parameters
| Parameter | مطلوب | الوصف |
|---|---|---|
| `lang` | ❌ | `ar` أو `en` |

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "order": {
      "_id": "67b1c2d3e4f5678901234567",
      "reference": "11254821",
      "user": null,
      "customer_name": "أحمد محمد",
      "customer_phone": "01012345678",
      "orderType": "delivery",
      "status": "pending",
      "cartItems": [ "..." ],
      "paymentMethod": { "_id": "...", "name": "Cash" },
      "warehouse": { "_id": "...", "name": "Main Online" }
    }
  }
}
```

---

### 2.3 تتبع الطلب برقم المرجع (Storefront — Get Order Status By Ref)

```http
GET /api/store/order/status/:ref
```

#### Headers & Query Parameters
- نفس headers و `lang` الاختيارية في `2.2`.

#### Path Parameters
| Parameter | مطلوب | الوصف |
|---|---|---|
| `ref` | ✅ | رقم المرجع `reference` الخاص بالطلب (مثال: `11254821`). |

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "order": {
      "_id": "67b1c2d3e4f5678901234567",
      "reference": "11254821",
      "user": null,
      "customer_name": "أحمد محمد",
      "customer_phone": "01012345678",
      "status": "pending",
      "cartItems": [ "..." ],
      "warehouse": { "_id": "...", "name": "..." },
      "paymentMethod": { "_id": "...", "name": "..." }
    }
  }
}
```

---

### 2.4 جلب طلبات العميل المسجل (Storefront — Get My Orders)

```http
GET /api/store/order/my-orders
```

#### Headers
| Header | مطلوب | الوصف |
|---|---|---|
| `Authorization` | ✅ (للعميل المسجل) | `Bearer <customer_jwt_token>` (يُفلتر بـ `req.user?.id`). |

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "_id": "67b1c2d3e4f5678901234567",
        "reference": "11254821",
        "customer_name": "أحمد محمد",
        "customer_phone": "01012345678",
        "status": "pending",
        "totalOrderPrice": 500,
        "totalPriceAfterDiscount": 550
      }
    ]
  }
}
```

---

### 2.5 جلب كل الأوردرات الأونلاين للأدمن (Admin — Get All Online Orders)

```http
GET /api/admin/online-orders
```

- **المصادقة والصلاحيات:** `authenticated`, `authorizeRoles("admin", "superadmin")`, `authorizePermissions("orders", "View")`.

#### Headers
| Header | مطلوب | الوصف |
|---|---|---|
| `Authorization` | ✅ | `Bearer <admin_jwt_token>` |
| `x-lang` / `x-language` | ❌ | `ar` أو `en` |

#### Query Parameters
| Parameter | مطلوب | القيم المتاحة | الوصف |
|---|---|---|---|
| `status` | ❌ | `pending`, `confirmed`, `processing`, `out_for_delivery`, `delivered`, `returned`, `failed_to_deliver`, `canceled`, `scheduled` | فلترة الأوردرات حسب الحالة. |
| `shippingMethod` | ❌ | `self`, `bosta` | فلترة حسب طريقة الشحن (`shipmentType`). |
| `lang` | ❌ | `ar`, `en` | تحديد لغة الاستجابة. |

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "message": "Online orders retrieved successfully",
    "count": 1,
    "activeMethod": "self",
    "orders": [
      {
        "_id": "67b1c2d3e4f5678901234567",
        "reference": "11254821",
        "user": null,
        "customer_name": "أحمد محمد",
        "customer_phone": "01012345678",
        "status": "pending",
        "orderType": "delivery",
        "totalOrderPrice": 500,
        "totalPriceAfterDiscount": 550,
        "cartItems": [ "..." ],
        "bostaShipment": null
      }
    ]
  }
}
```

---

### 2.6 جلب تفاصيل أوردر أونلاين للأدمن (Admin — Get Online Order By ID)

```http
GET /api/admin/online-orders/:id
```

- **المصادقة والصلاحيات:** `authenticated`, `authorizeRoles("admin", "superadmin")`, `authorizePermissions("orders", "View")`.

#### Headers
| Header | مطلوب | الوصف |
|---|---|---|
| `Authorization` | ✅ | `Bearer <admin_jwt_token>` |
| `x-lang` / `x-language` | ❌ | `ar` أو `en` |

#### Path Parameters
| Parameter | مطلوب | الوصف |
|---|---|---|
| `id` | ✅ | MongoDB `_id` الخاص بالأوردر. |

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "message": "Order retrieved successfully",
    "order": {
      "_id": "67b1c2d3e4f5678901234567",
      "reference": "11254821",
      "user": null,
      "customer_name": "أحمد محمد",
      "customer_phone": "01012345678",
      "status": "pending",
      "orderType": "delivery",
      "shippingAddress": { "..." },
      "cartItems": [ "..." ],
      "paymentMethod": { "..." },
      "warehouse": { "..." },
      "bostaShipment": null
    }
  }
}
```

---

### 2.7 إنشاء شحنات Bosta لأوردرات الـ Guest (Admin — Bulk Create Shipments)

```http
POST /api/admin/online-orders/bulk-create-shipments
```

- **المصادقة والصلاحيات:** `authenticated`, `authorizeRoles("admin", "superadmin")`, `authorizePermissions("orders", "Edit")`.
- **التعديل:** إذا كان الأوردر بدون `user` (Guest)، يتم بناء بيانات المستلم `receiver` لشحنة Bosta تلقائياً من `order.customer_name` و `order.customer_phone` بدلاً من رفض الأوردر بخطأ `Receiver phone missing`.

---

### 2.8 الأوردرات الأونلاين في شاشة الـ POS (Admin POS Online Orders)

| Endpoint | Method | الصلاحيات | الوصف |
|---|---|---|---|
| `/api/admin/pos-online-orders` | `GET` | `POS:View` + `orders:View` | يدعم query `?status=...` ويرجع `customer_name` و `customer_phone` لكل أوردر في `data.orders`. |
| `/api/admin/pos-online-orders/:id` | `GET` | `POS:View` + `orders:View` | يستقبل path param `id` ويرجع `customer_name` و `customer_phone` داخل `data.order`. |

#### Headers
| Header | مطلوب | الوصف |
|---|---|---|
| `Authorization` | ✅ | `Bearer <admin_jwt_token>` |

---

## 3. صيغة استجابات الأخطاء (Error Responses)

في حالة فشل التحقق (Joi Validation — `400`) أو حدوث خطأ من الكنترولر (`400` / `401` / `404` / `500`):

```json
{
  "success": false,
  "error": {
    "code": 400,
    "message": "Validation error or BadRequest message",
    "details": [
      "..."
    ]
  }
}
```

**أشهر حالات الخطأ:**
- `400 Bad Request`:
  - في حالة الـ Guest Checkout بدون إرسال الاسم أو الهاتف: `"customer_name is required for guest checkout"` أو `"customer_phone is required for guest checkout"`.
  - عدم وجود `Authorization` و `x-session-id` معاً في Checkout (`"User ID or Session ID is required to find your cart"`).
  - سلة فارغة (`"Cart is empty"`).
  - نقص بيانات مطلوبة في `createOrderSchema`.
- `401 Unauthorized`: توكن أدمن غير صالح أو منتهي الصلاحية في مسارات `/api/admin/...`.
- `404 Not Found`: الأوردر غير موجود (`Order not found`).

---

## 4. أمثلة cURL للتجربة

### إنشاء أوردر كـ Guest
```bash
curl -X POST "https://bcknd.systego.net/api/store/order/checkout?lang=ar" \
  -H "Content-Type: application/json" \
  -H "x-session-id: guest-session-12345" \
  -d '{
    "orderType": "delivery",
    "customer_name": "أحمد محمد",
    "customer_phone": "01012345678",
    "paymentMethod": "67a1b2c3d4e5f67890123456",
    "shippingAddress": {
      "street": "شارع التحرير",
      "city": "67a1b2c3d4e5f67890123411",
      "zone": "67a1b2c3d4e5f67890123422"
    }
  }'
```

### جلب تفاصيل الأوردر للأدمن
```bash
curl -X GET "https://bcknd.systego.net/api/admin/online-orders/67b1c2d3e4f5678901234567?lang=ar" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### جلب تفاصيل الأوردر في المتجر
```bash
curl -X GET "https://bcknd.systego.net/api/store/order/67b1c2d3e4f5678901234567?lang=ar"
```
