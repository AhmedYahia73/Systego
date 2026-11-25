# توثيق تعديلات Online Orders Pagination & Product Gallery by Options

ملخص التعديلات التي تمت على واجهات النظام:
1. تحويل `GET /api/admin/online-orders` إلى **Pagination** مع إضافة ملخص الإجماليات (`summary`).
2. إضافة endpoint عام (بدون Auth) `POST /api/store/product/gallery` لإرجاع `gallery` الخاص بالمتغير (`ProductPrice`) حسب مصفوفة الـ `options`.

---

## 1) Admin — Get All Online Orders (Paginated + Summary)

### الشرح
تم تحديث endpoint جلب الطلبات الأونلاين للأدمن ليقوم بما يلي:
- دعم الـ **Pagination** عبر معاملات `page` و `limit` بدلًا من إرجاع كل الطلبات دفعة واحدة.
- حساب إجماليات مجمعة (`summary`) عبر **MongoDB Aggregation** على جميع الطلبات المطابقة لنفس الفلتر (`isDeleted: { $ne: true }` مع `status` و `shippingMethod` إن وُجدا)، بحيث تعكس الأرقام إجمالي كل النتائج المطابقة وليس الصفحة الحالية فقط:
  - `totalTaxAmount`: مجموع `taxAmount`.
  - `total`: مجموع `totalPriceAfterDiscount + taxAmount`.
  - `totalShippingPrice`: مجموع `shippingPrice`.

### Endpoint
```http
GET /api/admin/online-orders
```

- **المصادقة والصلاحيات:** `authenticated`, `authorizeRoles("admin", "superadmin")`, `authorizePermissions("orders", "View")`.
- **الملفات المعدّلة:**
  - `src/controller/admin/onlineOrders.ts` (`getAllOnlineOrders`)

### Headers
| Header | مطلوب | الوصف |
|---|---|---|
| `Authorization` | ✅ | `Bearer <admin_jwt_token>` |
| `Accept` | ❌ | `application/json` |
| `x-lang` / `x-language` | ❌ | `ar` أو `en` |

### Params

#### Path Params
لا يوجد.

#### Query Params
| Parameter | النوع | مطلوب | الافتراضي | الوصف |
|---|---|---|---|---|
| `page` | `number` | ❌ | `1` | رقم الصفحة المطلوبة (أقل قيمة `1`). |
| `limit` | `number` | ❌ | `20` | عدد الطلبات في الصفحة (من `1` إلى `100`). |
| `status` | `string` | ❌ | — | فلترة حسب حالة الطلب (`pending`, `confirmed`, `processing`, `out_for_delivery`, `delivered`, `returned`, `failed_to_deliver`, `canceled`, `scheduled`). |
| `shippingMethod` | `string` | ❌ | — | فلترة حسب طريقة الشحن (`self`, `bosta`). |
| `lang` | `string` | ❌ | — | تحديد لغة الاستجابة (`ar`, `en`). |

### Body
لا يوجد (طلب `GET`).

### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "message": "Online orders retrieved successfully",
    "count": 20,
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 125,
      "pages": 7
    },
    "summary": {
      "totalTaxAmount": 1500,
      "total": 45200,
      "totalShippingPrice": 2100
    },
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
        "shippingPrice": 50,
        "taxAmount": 25,
        "totalOrderPrice": 500,
        "totalPriceAfterDiscount": 550,
        "cartItems": [],
        "bostaShipment": null
      }
    ]
  }
}
```

#### شرح حقول الاستجابة الجديدة
| الحقل | الوصف |
|---|---|
| `count` | عدد الطلبات المعروضة في الصفحة الحالية فقط. |
| `pagination.page` | رقم الصفحة الحالية. |
| `pagination.limit` | الحد الأقصى لعدد العناصر في الصفحة. |
| `pagination.total` | إجمالي عدد الطلبات المطابقة للفلتر في جميع الصفحات. |
| `pagination.pages` | إجمالي عدد الصفحات. |
| `summary.totalTaxAmount` | مجموع `taxAmount` لكل الطلبات المطابقة للفلتر (مقرّب لرقمين عشريين). |
| `summary.total` | مجموع `(totalPriceAfterDiscount + taxAmount)` لكل الطلبات المطابقة للفلتر (مقرّب لرقمين عشريين). |
| `summary.totalShippingPrice` | مجموع `shippingPrice` لكل الطلبات المطابقة للفلتر (مقرّب لرقمين عشريين). |

---

## 2) Storefront — Get Product Price Gallery by Options (Public)

### الشرح
في واجهات المتجر، كان يتم إخفاء مصفوفة `prices` من استجابة المنتج وإظهار `variations` و `options` فقط. تم إنشاء API عام (بدون أي مصادقة) يستقبل مصفوفة `options` (ويمكن تمرير `productId` اختياريًا) ويرجع `gallery` الخاصة بالـ `ProductPrice` المطابق:
- يتم أولًا البحث عن **مطابقة كاملة** (`exact match`) لنفس مجموعة الـ `options` المرسلة.
- في حال عدم وجود مطابقة كاملة (مثل اختيار العميل للون فقط قبل اختيار المقاس)، يتم استخدام **مطابقة جزئية** (`subset match`) للمتغير الذي يحتوي على كل الـ `options` المرسلة.
- عند وجود أكثر من متغير مطابق، يتم تفضيل السجل الذي يحتوي على صور غير فارغة في `gallery`.
- في حال عدم وجود أي تطابق، يرجع `productPriceId: null` و `gallery: []`.

### Endpoint
```http
POST /api/store/product/gallery
```

- **المصادقة والصلاحيات:** لا يوجد (Public — بدون أي Auth، وتم تسجيله قبل `optionalAuthenticated` في الراوتر).
- **الملفات المعدّلة:**
  - `src/controller/users/products.ts` (`getGalleryByOptions`, `pickMatchingPrice`)
  - `src/routes/users/products.ts`

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
```json
{
  "options": [
    "67b1c2d3e4f5678901234567",
    "67b1c2d3e4f5678901234568"
  ],
  "productId": "6afebc83783fcaf1c5e35591"
}
```

| الحقل | النوع | مطلوب | الوصف |
|---|---|---|---|
| `options` | `string[]` | ✅ | مصفوفة غير فارغة من `ObjectId` الخاصة بالـ options المختارة. |
| `productId` | `string` | ❌ | `ObjectId` للمنتج لتقييد البحث داخل متغيرات هذا المنتج فقط (مفيد عند اشتراك نفس الـ `option` بين عدة منتجات). |

### Responses

#### Success (`200 OK`) — عند وجود تطابق
```json
{
  "success": true,
  "data": {
    "message": "Gallery retrieved successfully",
    "productPriceId": "67b1c2d3e4f5678901239999",
    "gallery": [
      "https://bcknd.systego.net/uploads/products/img1.webp",
      "https://bcknd.systego.net/uploads/products/img2.webp"
    ]
  }
}
```

#### Success (`200 OK`) — عند عدم وجود تطابق
```json
{
  "success": true,
  "data": {
    "message": "Gallery retrieved successfully",
    "productPriceId": null,
    "gallery": []
  }
}
```

#### Error (`400 Bad Request`) — عند إرسال بيانات غير صالحة
- إذا كانت `options` غير موجودة أو فارغة: `"options array is required"`
- إذا كان أحد عناصر `options` ليس `ObjectId` صالحًا: `"Invalid option ID in options array"`
- إذا تم إرسال `productId` غير صالح: `"Invalid productId"`
