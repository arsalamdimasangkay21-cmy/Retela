# RETELA: An AI-Assisted Sales and Inventory Management System for Tela to Pera Thrift Shop

## 1. System Overview

### System Name

**RETELA: An AI-Assisted Sales and Inventory Management System for Tela to Pera Thrift Shop**

### Description

RETELA is a web-based sales, inventory, customer management, messaging, reporting, and marketing system developed for Tela to Pera Thrift Shop. The system centralizes apparel product records, stock movement, order processing, barcode/SKU generation, customer shopping, payment handling, broadcast promotions, notifications, returns, feedback, and AI-assisted customer support.

The system provides two main interfaces: an Admin Portal for business operations and a Customer Portal for shopping and account interaction. Inventory is the source of truth for products, stocks, and barcode data. Apparel Catalog, Customer Shop, Orders, Reports, Analytics, and Barcode Management use inventory records as their primary product source.

### Purpose

The purpose of RETELA is to improve the accuracy, speed, and organization of thrift shop operations by replacing manual product tracking, customer inquiries, order handling, and promotional activities with a centralized digital system.

### Objectives

| Objective | Description |
|---|---|
| Centralize product records | Store apparel information, stock, images, SKU/barcode, category, brand, size, condition, and price in one inventory source. |
| Improve inventory control | Monitor stock levels, update quantities, identify low-stock/out-of-stock items, and prevent duplicate product records. |
| Support customer shopping | Allow customers to browse products, view details, manage cart selections, apply coupons, and checkout. |
| Enable secure transactions | Support COD and PayMongo-based payment channels such as GCash, Maya, Debit Card, and Credit Card. |
| Automate barcode handling | Generate SKU/barcode values automatically and support batch barcode label printing. |
| Improve communication | Provide admin-customer conversations, AI chatbot support, broadcasts, notifications, and promotional announcements. |
| Provide business insight | Generate dashboard summaries, reports, analytics, sales trends, inventory status, and customer activity information. |
| Support deployment readiness | Provide Clear Demo Data controls while preserving accounts, roles, settings, and credentials. |

### Scope

RETELA covers:

- Admin account management and customer account monitoring.
- Product creation and management through Inventory.
- Apparel catalog display based on inventory products.
- Customer shop display of available inventory items with stock greater than zero.
- SKU/barcode generation and barcode printing.
- Cart item selection, coupon validation, sale discounts, checkout, and payment redirection.
- Order tracking, payment status tracking, fulfillment status, and delivery/pickup handling.
- Broadcast campaigns, sale promotions, promo codes, sale products, and customer notifications.
- AI-assisted chatbot and admin conversation takeover.
- Reports, analytics, feedback, returns/refunds, archive, trash bin, settings, and profile management.

### Limitations

| Limitation | Description |
|---|---|
| Internet dependency | Online payments, OTP delivery, AI chatbot, and real-time updates require network connectivity. |
| Payment provider dependency | GCash, Maya, Debit, and Credit payments depend on PayMongo API availability and valid configuration. |
| AI dependency | AI chatbot quality and availability depend on configured OpenAI API credentials and provider availability. |
| Barcode scanning dependency | Barcode search works with typed/scanned SKU input; physical scanner performance depends on scanner hardware acting as keyboard input. |
| Audit logs | The system provides logs/settings access and timestamps, but a dedicated immutable audit-log table is a recommended enhancement. |
| Database technology | The implemented system uses MySQL/MariaDB relational tables through `mysql2`, not MongoDB. If MongoDB is required by a proposal template, the implementation documentation should be updated only after an actual database migration. |

### Intended Users

| User Type | Description |
|---|---|
| Admin/Super Admin | Shop owner or authorized personnel responsible for inventory, orders, customers, reports, broadcasts, settings, and deployment data cleanup. |
| Customer/User | Registered buyer who shops apparel, manages cart/orders, receives notifications, sends messages, uses chatbot, and submits feedback/returns. |

## 2. System Modules

### Admin Modules

| Module | Description |
|---|---|
| Dashboard | Displays business summary, stock indicators, sales overview, customer activity, and operational signals. |
| Apparel Catalog | Displays inventory products as clean product cards for catalog management. Apparel does not create separate products. |
| Inventory Management | Source of truth for product creation, product updates, stock quantity, images, SKU/barcode, status, and product availability. |
| Barcode Management | Inventory-based barcode selection and batch printing module with 3-column A4/bond-paper layout. |
| Orders | Displays customer orders, order items, payment method/status, fulfillment status, tracking, and order updates. |
| Customers | Displays customer accounts, profile details, approval/status controls, online activity, and customer management actions. |
| Conversations | Provides admin-customer messaging, AI chatbot context, admin takeover, archive, and deletion controls. |
| Analytics | Provides sales and inventory metrics, product performance, revenue trends, and business visualization. |
| Reports | Generates sales, inventory, customer, order, and analytics reports with print/export support. |
| Broadcasts | Creates customer announcements, promo campaigns, sale promotions, channels, schedules, and AI-generated marketing messages. |
| Automations | Shows operational automation templates and system-triggered business processes. |
| Feedback | Displays customer reviews, ratings, categories, comments, and feedback image attachments. |
| Returns | Manages return/refund requests, proof images, reason category, refund type, admin decisions, and status updates. |
| Archive | Shows archived apparel and conversations and supports restore actions. |
| Trash Bin | Shows deleted apparel, conversations, and broadcasts and supports restore/permanent delete actions. |
| Notifications | Displays admin notifications for registration, feedback, inventory, order, and message events. |
| Settings | Manages shop profile, payment profile, AI settings, coupons, shipping, appearance, data management, and clear demo data. |
| Profile | Allows admin to update personal account details, profile photo, password, and related information. |

### Customer Modules

| Module | Description |
|---|---|
| Registration | Allows customers to create an account using contact details and password. |
| Login | Authenticates users using credentials and JWT token creation. |
| OTP Verification | Verifies customer registration or password reset using one-time passcodes. |
| Shop | Displays available inventory products with stock greater than zero. |
| Product Details | Shows product image, name, brand, category, size, condition, description, price, stock, and status. |
| Cart | Allows item selection, quantity changes, coupon entry, selected-only totals, and checkout preparation. |
| Checkout | Displays selected items, discounts, shipping fee, payment method, and final total in a checkout modal. |
| Orders | Shows customer order history, payment state, status progress, and payment retry where applicable. |
| Notifications | Shows clickable notification cards with broadcast/promo/order/message/system details. |
| Broadcasts | Receives admin broadcast campaigns, announcements, promo codes, and sale product notifications. |
| Coupons | Allows customer coupon entry and validates discount/free shipping against admin-controlled settings. |
| Messages | Allows customer communication with admin through conversations. |
| AI Chatbot | Provides AI-assisted responses based on shop/product context with optional admin takeover. |
| Profile | Allows user profile update, contact details, password change, and account deactivation. |
| Settings | Provides customer-specific settings including per-user dark mode preference. |

## 3. Complete Feature Description

| Feature Name | Purpose | Inputs | Processes | Outputs | User Access |
|---|---|---|---|---|---|
| Admin Dashboard | Summarize business operations | Sales, products, users, notifications, orders | Aggregates backend reports and live events | Summary cards, charts, alerts | Admin |
| Apparel Catalog | Display products from inventory | Product filters/search | Reads products from inventory source | Product cards with edit/delete actions | Admin |
| Add Apparel Item | Create inventory product | Name, brand, category, size, condition, price, stock, description, image | Validates input, checks duplicates, inserts/merges product, generates SKU | Product record, inventory stock, customer shop visibility | Admin |
| Edit Apparel Item | Update product data | Product fields and optional image | Validates and updates inventory product | Updated product record | Admin |
| Delete/Archive Apparel | Remove product from active catalog | Product ID | Marks product deleted/archived | Product hidden from active inventory/shop | Admin |
| Restore Apparel | Return deleted product to active list | Product ID | Clears deletion fields and recomputes status | Restored inventory item | Admin |
| Inventory Stock Update | Adjust stock quantity | Product ID, stock delta | Updates stock and status, emits inventory update | Updated stock and stock badge | Admin |
| Barcode Generation | Assign unique SKU | Product ID | Generates `RETELA-000001` style SKU after product creation | SKU/barcode value stored in database | Admin/System |
| Barcode Search/Scanner | Find product by SKU | Typed/scanned SKU | Matches barcode/SKU against product records | Product details and status | Admin |
| Barcode Printing | Print selected barcode labels | Selected product IDs | Generates barcode SVG labels in 3-column A4 layout | Printable barcode sheet | Admin |
| Customer Shop | Show purchasable apparel | Filters/search | Fetches available inventory products only | Product grid | Customer |
| Product Details | Inspect item before buying | Product selection | Opens details modal | Full product details and buy/add actions | Customer |
| Cart Selection | Include selected items only | Item checkbox, select all | Computes selected-only subtotal, discounts, shipping, total | Updated cart totals | Customer |
| Coupon Validation | Apply admin coupon | Coupon code, selected items | Validates active/expired coupon and discount/free shipping rules | Discount or error message | Customer/Admin settings |
| Sale Discount | Apply broadcast sale | Active sale product IDs and dates | Matches selected cart items to active sale promotions | Sale discount and sale label | Customer |
| Checkout Summary | Confirm purchase details | Selected cart items, payment method | Displays modal with selected products and totals | Confirm/cancel checkout | Customer |
| COD Checkout | Create COD order | Selected cart items | Validates stock, creates order, decrements stock | Pending COD order | Customer |
| Online Payment Checkout | Redirect to provider | Order ID, payment method, billing phone | Creates PayMongo checkout session | Checkout URL and awaiting payment order | Customer |
| Payment Webhook | Update payment status | PayMongo webhook payload | Verifies event and updates order | Paid/failed payment status | System |
| Order Management | Process orders | Order status/tracking | Admin updates lifecycle | Updated order status and notifications | Admin |
| Notifications | Inform users of events | Event payloads | Creates and marks notifications read | Notification list and detail modal | Admin/Customer |
| Broadcast Campaign | Send announcements/promos | Title, message, audience, channels, promo, sale products, schedule | Creates or sends campaign, tracks deliveries | Customer notifications, delivery stats | Admin |
| AI Broadcast Generation | Assist marketing copy | Campaign prompt, audience, promo code | Sends prompt to OpenAI when configured | Suggested broadcast message | Admin |
| Conversations | Manage customer messages | Message text, conversation ID | Stores messages, emits real-time updates | Threaded chat | Admin/Customer |
| AI Chatbot | Answer customer inquiries | Customer message | Uses product/shop context and OpenAI | AI response and metadata | Customer/Admin |
| Feedback/Reviews | Collect customer experience | Rating, category, comment, image | Stores review and notifies admin | Feedback record | Customer/Admin |
| Returns/Refunds | Process return requests | Order, reason, proof images, refund type | Stores request, admin approves/rejects/refunds | Return status and notification | Customer/Admin |
| Reports | Generate business reports | Date range/report type | Aggregates sales, orders, inventory, customers | Printable/exportable reports | Admin |
| Analytics | Visualize performance | Sales/order/product data | Computes revenue, trends, top items | Charts and analytics cards | Admin |
| Settings | Configure system | Shop, payment, AI, coupon, shipping, appearance settings | Validates and saves settings | Updated system behavior | Admin |
| Dark Mode | Save account-specific theme | Toggle state, user ID/role | Stores localStorage key per user | Light/dark UI per account | Admin/Customer |
| Clear Demo Data | Prepare for deployment | Confirmation | Deletes business sample data only | Empty business modules and success message | Admin/Super Admin |
| Profile Management | Update account details | Profile fields/photo/password | Validates and saves user details | Updated account profile | Admin/Customer |

## 4. System Workflow

### Registration Process

1. Customer opens the registration form.
2. Customer enters username, email or phone number, location, and password.
3. Backend validates uniqueness and hashes password using bcrypt.
4. System generates OTP and stores OTP code and expiration.
5. OTP is sent through configured email/SMS channel.
6. Customer submits OTP.
7. System verifies OTP and marks account as approved/verified.
8. Customer can log in and access the customer portal.

### Login Process

1. User submits login credentials.
2. Backend validates user record and bcrypt password hash.
3. System checks role, verification, and account status.
4. Backend issues JWT.
5. Frontend stores authenticated user state and applies per-user theme.
6. User is redirected to Admin or Customer dashboard depending on role.

### Product Creation Process

1. Admin clicks Add Apparel Item from Apparel or Inventory.
2. If clicked from Apparel, system redirects to Inventory and opens the Inventory product modal.
3. Admin enters product details and image.
4. Backend validates fields with Zod.
5. Backend checks duplicate product signature.
6. If duplicate exists, stock is combined instead of creating a new record.
7. If new, product is inserted into `apparel_items`.
8. System generates SKU such as `RETELA-000001`.
9. Product appears in Inventory, Apparel Catalog, and Customer Shop if stock is greater than zero.

### Inventory Process

1. Admin opens Inventory.
2. System loads products from inventory records.
3. Admin searches, filters, edits, deletes, or adjusts stock.
4. Stock update recomputes status: In Stock, Low Stock, or Out of Stock.
5. Inventory updates are emitted through Socket.IO.
6. Customer shop availability updates based on stock.

### Barcode Generation Process

1. Product is created in inventory.
2. Backend receives insert ID.
3. `productSkuForId()` formats the SKU as `RETELA-` plus six-digit ID.
4. SKU is stored in the product record.
5. Barcode SVG is rendered from the SKU value on the frontend.

### Barcode Printing Process

1. Admin opens Inventory and clicks Barcodes.
2. System displays all inventory items with circular selectors.
3. Admin selects individual items or Select All.
4. Admin clicks Print Selected Barcodes.
5. System generates a printable A4/bond-paper page.
6. Barcodes are arranged in a 3-column grid.
7. Extra labels automatically continue to the next printed page.

### Shopping Process

1. Customer opens Shop.
2. System loads available inventory products where stock is greater than zero.
3. Customer filters/searches products.
4. Customer views product details.
5. Customer adds item to cart or uses Buy Now.

### Cart Process

1. Customer views cart.
2. Customer selects individual items or Select All.
3. Only selected items are included in subtotal, discounts, shipping, and checkout.
4. Customer may enter coupon.
5. System validates coupon and applies discounts only to selected items.
6. Unselected items remain in cart.

### Checkout Process

1. Customer selects cart items and payment method.
2. Customer clicks Checkout.
3. Floating checkout summary modal displays selected items, quantities, price, discounts, shipping fee, payment method, and total.
4. Customer confirms checkout.
5. Backend validates stock and pricing server-side.
6. Order and order items are created.
7. Only checked-out items are removed from cart.

### Payment Process

1. Customer selects COD, GCash, Maya, Debit, or Credit.
2. COD creates an unpaid/pending order for admin processing.
3. Online payment creates a PayMongo checkout session.
4. Customer is redirected to PayMongo-hosted checkout.
5. PayMongo webhook updates order payment status.
6. Customer can view order payment status in Orders.

### Broadcast Process

1. Admin creates broadcast title/message.
2. Admin selects audience, channels, schedule, promo code, sale products, and discount percentage.
3. Admin may generate copy using OpenAI.
4. Broadcast is saved as draft, scheduled, or sent.
5. In-app delivery creates customer notifications.
6. Email/SMS/AI chat delivery is attempted depending on channels.
7. Delivery, open, and click stats are tracked.

### Notification Process

1. System creates notification from events such as orders, messages, broadcasts, products, feedback, returns, or inventory.
2. Socket.IO emits real-time notification updates.
3. Customer notifications are clickable.
4. Clicking opens a detail modal and marks the notification as read.
5. Broadcast/promo notifications display promo code, discount, promo dates, related products, and shop action.

### Return Process

1. Customer selects order and submits return reason, category, refund type, and proof images.
2. Backend stores return request.
3. Admin reviews request.
4. Admin approves, rejects, or marks refunded.
5. System updates return status and can notify customer.

### Archive Process

1. Admin archives product/conversation or deletes product in a soft-delete workflow.
2. Record remains stored but hidden from active views.
3. Archive page lists restorable archived items.
4. Admin restores item when needed.

### Trash Bin Process

1. Admin deletes supported records.
2. Record is marked deleted with deletion metadata.
3. Trash Bin displays deleted apparel, conversations, and broadcasts.
4. Admin may restore or permanently delete records.

### Analytics Process

1. System reads orders, order items, products, customers, returns, and reviews.
2. Backend computes totals, trends, revenue, top products, inventory counts, and customer metrics.
3. Frontend displays charts, cards, and reports.
4. Admin exports or prints report data where supported.

## 5. Database Documentation

### Database Technology

The implemented system uses **MySQL/MariaDB relational database** through the Node.js `mysql2` package. The SQL schema is located in `database/schema.sql`.

### Tables and Fields

| Table/View | Primary Key | Important Fields | Purpose |
|---|---|---|---|
| `users` | `id` | username, display_name, email, phone_number, location, birthday, gender, password_hash, role, status, is_verified, otp_code, preferences, last_active_at | Stores admin/customer accounts, login credentials, OTP state, profile, and role. |
| `system_settings` | `id` | config_json, openai_api_key_encrypted | Stores shop settings, coupons, shipping, payment, AI, appearance, and encrypted OpenAI key. |
| `apparel_items` | `id` | sku, name, brand, category, gender, size, color, price, stock, status, image_url, condition, description, is_deleted | Source table for all products, inventory, stock, images, and SKU/barcodes. |
| `products` | View | Same selected fields from `apparel_items` | Compatibility view used by product routes and queries. |
| `orders` | `id` | user_id, status, payment_method, payment_status, tracking_number, fulfillment_method, total_amount | Stores customer orders and payment/fulfillment state. |
| `order_items` | `id` | order_id, product_id, quantity, price | Stores line items for each order. |
| `conversations` | `id` | customer_id, admin_takeover, ai_processing, is_archived, is_deleted, AI metadata | Stores customer-admin/AI conversation sessions. |
| `messages` | `id` | conversation_id, sender_id, sender_type, mode, body, delivery_status, AI metadata | Stores chat messages. |
| `notifications` | `id` | user_id, product_id, broadcast_id, type, title, body, is_read | Stores admin and customer notifications. |
| `broadcasts` | `id` | title, message, image_url, promo_code, audience, broadcast_type, status, channels_json, sale fields | Stores admin marketing/broadcast campaigns. |
| `broadcast_deliveries` | `id` | broadcast_id, user_id, notification_id, channel, delivery_status, opened_at, clicked_at | Tracks delivery and engagement of broadcasts. |
| `reviews` | `id` | user_id, order_id, product_id, rating, category, comment, image_url | Stores feedback and reviews. |
| `returns` | `id` | order_id, user_id, reason, reason_category, refund_type, proof_images, status, admin_note | Stores return/refund requests and decisions. |

### Relationships

| Relationship | Type | Description |
|---|---|---|
| users to orders | One-to-many | One customer may create many orders. |
| users to conversations | One-to-many | One customer may have conversation records. |
| users to notifications | One-to-many | Notifications may belong to a specific user or be global. |
| users to reviews | One-to-many | Customers can submit multiple reviews. |
| users to returns | One-to-many | Customers can submit multiple returns. |
| apparel_items to order_items | One-to-many | A product can appear in many order items. |
| orders to order_items | One-to-many | One order contains multiple line items. |
| orders to returns | One-to-many | One order may have return requests. |
| conversations to messages | One-to-many | One conversation contains many messages. |
| broadcasts to notifications | One-to-many | A broadcast may create many customer notifications. |
| broadcasts to broadcast_deliveries | One-to-many | A broadcast has many delivery records. |
| notifications to broadcast_deliveries | One-to-one/optional | Delivery may reference the created in-app notification. |

### Foreign Keys

| Table | Foreign Key | References |
|---|---|---|
| orders | user_id | users(id) |
| order_items | order_id | orders(id) |
| order_items | product_id | apparel_items(id) |
| conversations | customer_id | users(id) |
| messages | conversation_id | conversations(id) |
| messages | sender_id | users(id) |
| notifications | user_id | users(id) |
| notifications | product_id | apparel_items(id) |
| notifications | broadcast_id | broadcasts(id) |
| broadcasts | created_by | users(id) |
| broadcast_deliveries | broadcast_id | broadcasts(id) |
| broadcast_deliveries | user_id | users(id) |
| broadcast_deliveries | notification_id | notifications(id) |
| reviews | user_id | users(id) |
| reviews | order_id | orders(id) |
| reviews | product_id | apparel_items(id) |
| returns | order_id | orders(id) |
| returns | user_id | users(id) |

## 6. User Roles and Permissions

### Admin

Admin users have full operational access:

- View dashboard, analytics, and reports.
- Create, update, archive, restore, and delete inventory products.
- Manage barcode selection and printing.
- Manage orders, status, payment review, and tracking.
- Manage customers and account statuses.
- Use conversations and AI-assisted messaging.
- Create broadcasts, promo campaigns, coupons, sale discounts, and notifications.
- Review feedback and returns.
- Access archive and trash bin.
- Configure system settings, shop profile, payment profile, AI settings, shipping, coupons, dark mode, and data management.
- Clear demo data before deployment without deleting user/admin accounts.

### Customer

Customer users have controlled access:

- Register, verify OTP, log in, and manage profile.
- Browse available apparel.
- View product details.
- Add/select cart items and checkout selected products.
- Apply valid coupons.
- Pay using COD, GCash, Maya, Debit, or Credit where configured.
- View order history and payment status.
- Receive and open notifications and broadcasts.
- Send messages and use AI chatbot.
- Submit feedback and return/refund requests.
- Manage personal dark mode preference.

Customer limitations:

- Cannot access admin dashboards, inventory creation, barcode management, reports, broadcasts, customer lists, settings, archive, or trash bin.
- Cannot buy products with zero stock.
- Cannot apply expired/invalid coupons.
- Cannot change other users' theme or profile settings.

## 7. Input-Process-Output Model

| Input | Process | Output |
|---|---|---|
| Registration details | Validate fields, hash password, generate OTP | Pending/verified customer account |
| Login credentials | Compare bcrypt hash, verify status, issue JWT | Authenticated session |
| Product details | Validate, duplicate check, insert/merge, generate SKU | Inventory product record |
| Product image | Upload with Multer, store file URL | Product image display |
| Stock adjustment | Update stock, recompute status, emit event | Updated inventory and customer shop availability |
| SKU/barcode query | Match scanned/typed SKU | Matching product details |
| Barcode selections | Generate printable HTML/SVG labels | 3-column A4 barcode sheet |
| Cart selections | Compute selected-only pricing | Subtotal, discounts, shipping, total |
| Coupon code | Validate active coupon/settings | Applied discount/free shipping or error |
| Checkout request | Validate stock/pricing, create order, decrement stock | Order record and updated inventory |
| Online payment request | Create PayMongo checkout session | Payment checkout URL |
| PayMongo webhook | Verify and update order | Paid/failed payment status |
| Broadcast details | Save/send campaign, create deliveries | Customer notifications and stats |
| Chat message | Store message, AI/admin response, real-time emit | Conversation thread update |
| Return request | Validate order and proof, store request | Return case for admin review |
| Report filters | Aggregate database records | Report tables/charts/export |
| Settings form | Validate config and save | Updated system settings |
| Clear demo confirmation | Delete business sample data only | Fresh deployment-ready business records |

## 8. System Architecture

### Frontend

| Technology | Description |
|---|---|
| React | Component-based frontend for Admin and Customer interfaces. |
| Vite | Frontend build tool and development server. |
| Tailwind CSS | Utility-first styling framework used for responsive UI. |
| Framer Motion | Animation library for modals, cards, and transitions. |
| Chart.js/Recharts | Charting libraries for dashboard, analytics, and reports. |
| Axios | HTTP client for API communication. |
| Socket.IO Client | Receives real-time notifications, inventory updates, order events, and broadcast progress. |

### Backend

| Technology | Description |
|---|---|
| Node.js | JavaScript runtime for backend services. |
| Express.js | API framework for authentication, users, products, orders, messages, notifications, broadcasts, reports, payments, returns, reviews, and settings. |
| Zod | Input validation for API payloads. |
| Multer | File upload handling for product, profile, broadcast, review, and return images. |
| Helmet/CORS/Rate Limit | API hardening and request protection. |

### Database

| Technology | Description |
|---|---|
| MySQL/MariaDB | Implemented relational database engine. |
| mysql2 | Backend database driver. |
| SQL schema | Tables and relationships are defined in `database/schema.sql`. |

**Note:** The requested outline mentions MongoDB. The current implemented RETELA codebase does not use MongoDB. It uses MySQL/MariaDB.

### Authentication

| Technology | Description |
|---|---|
| JWT | Token-based API authentication. |
| bcryptjs | Password hashing and verification. |
| OTP | Registration and password reset verification. |

### Real-Time

| Technology | Description |
|---|---|
| Socket.IO | Real-time notifications, user activity, inventory updates, product updates, order events, typing indicators, and broadcast progress. |

### Payment

| Technology | Description |
|---|---|
| PayMongo | Creates hosted checkout sessions and receives webhook updates. |
| GCash | Supported through PayMongo checkout session. |
| Maya | Supported through PayMongo checkout session. |
| Debit/Credit | Supported through PayMongo checkout session. |
| COD | Stored as cash-on-delivery order without online redirect. |

### AI

| Technology | Description |
|---|---|
| OpenAI API | AI chatbot responses and AI-generated broadcast marketing messages. |
| Encrypted API Key Storage | OpenAI API key is stored encrypted in system settings. |

## 9. Security Features

| Security Feature | Description |
|---|---|
| Password Hashing | User passwords are hashed using bcryptjs before storage. |
| JWT Authentication | Protected routes require valid bearer tokens. |
| OTP Verification | Customer registration and password reset require OTP verification. |
| Role-Based Access Control | Admin-only routes are protected by role middleware. |
| Approved Account Checks | Customer actions require approved/verified account status. |
| Input Validation | Zod schemas validate API inputs. |
| Protected Routes | Admin and customer frontend routes depend on authenticated user role. |
| Rate Limiting | Express rate limiter reduces abusive API requests. |
| Helmet | Adds common HTTP security headers. |
| CORS Restrictions | API accepts configured client origins only. |
| File Upload Controls | Multer handles uploaded images and storage paths. |
| Payment Webhook Handling | PayMongo webhook updates payment state through backend route. |
| Per-User Theme Storage | Theme preferences use user-specific localStorage keys and do not affect other accounts. |
| Operational Logs | Settings logs and created/updated timestamps provide operational traceability. Dedicated immutable audit logs are recommended for future enhancement. |

## 10. Reports Generated

| Report | Description | Users |
|---|---|---|
| Sales Reports | Displays revenue, sold items, payment methods, order details, and date-range sales data. | Admin |
| Inventory Reports | Displays product count, stock, low-stock/out-of-stock items, and inventory status. | Admin |
| Customer Reports | Displays customer records, activity, and order/customer-related information. | Admin |
| Analytics Reports | Displays visual business metrics, charts, and trend summaries. | Admin |
| Order Reports | Displays order status, item quantity, payment, total, and created dates. | Admin |

## 11. System Integrations

| Integration | Purpose |
|---|---|
| OpenAI | AI chatbot and AI-generated broadcast content. |
| PayMongo | Hosted checkout sessions and payment status webhooks. |
| GCash | Payment option through PayMongo. |
| Maya | Payment option through PayMongo. |
| Debit/Credit | Card payment options through PayMongo. |
| Email OTP | Sends registration OTP through configured email service. |
| SMS OTP | Password reset OTP can use SMS provider configuration. |
| Socket.IO | Real-time notifications, inventory/order/product/chat/broadcast events. |
| Local File Uploads | Stores uploaded product, profile, review, return, and broadcast images. |

## 12. System Functions

### Authentication Functions

| Function/Route | Description |
|---|---|
| `POST /api/auth/register` | Registers customer account, hashes password, stores OTP. |
| `POST /api/auth/verify-otp` | Verifies registration OTP and approves account. |
| `POST /api/auth/resend-otp` | Sends a new registration OTP. |
| `POST /api/auth/login` | Authenticates user and returns JWT/user data. |
| `GET /api/auth/me` | Returns authenticated user profile. |
| `POST /api/auth/password-reset/request` | Creates password reset OTP. |
| `POST /api/auth/password-reset/verify` | Verifies reset OTP. |
| `POST /api/auth/password-reset/complete` | Updates password after reset verification. |

### User/Profile Functions

| Function/Route | Description |
|---|---|
| `GET /api/users/me` | Retrieves current user profile. |
| `PATCH /api/users/me` | Updates profile fields and profile photo. |
| `PATCH /api/users/me/password` | Changes current user's password. |
| `PATCH /api/users/me/deactivate` | Deactivates customer account. |
| `GET /api/users` | Admin customer listing. |
| `PATCH /api/users/:id/status` | Admin changes user status. |
| `DELETE /api/users/:id` | Admin removes customer account. |
| `GET /api/users/admin/payment-profile` | Retrieves admin payment/shop payment profile. |

### Product, Inventory, and Barcode Functions

| Function/Route | Description |
|---|---|
| `GET /api/products` | Retrieves product list based on filters and role. |
| `GET /api/products/inventory` | Admin retrieves all inventory products. |
| `GET /api/products/available` | Retrieves available products. |
| `GET /api/products/archived` | Admin retrieves archived products. |
| `GET /api/products/barcode/:sku` | Admin finds product by barcode/SKU. |
| `GET /api/products/filters` | Retrieves filter values for shop/catalog. |
| `POST /api/products` | Admin creates inventory product and SKU. |
| `PUT /api/products/:id` | Admin updates product. |
| `PATCH /api/products/:id/stock` | Admin adjusts stock. |
| `DELETE /api/products/:id` | Admin soft-deletes product to trash. |
| `PATCH /api/products/:id/restore` | Admin restores deleted product. |
| `DELETE /api/products/:id/permanent` | Admin permanently deletes product from trash. |
| `productSkuForId()` | Generates `RETELA-000001` style SKU. |
| `findDuplicateActiveProduct()` | Prevents duplicate products by merging stock into existing matching item. |
| `BarcodeSvg` | Frontend barcode preview renderer. |
| `printProductBarcodes()` | Frontend batch barcode label printer using 3-column A4 layout. |

### Order and Checkout Functions

| Function/Route | Description |
|---|---|
| `GET /api/orders` | Retrieves admin/customer orders depending on role. |
| `GET /api/orders/:id/items` | Retrieves order item details. |
| `POST /api/orders` | Creates order, validates pricing, discounts, stock, and decrements stock. |
| `PATCH /api/orders/:id/status` | Admin updates order status. |
| `PATCH /api/orders/:id/tracking` | Admin updates tracking number. |
| `calculateCheckoutPricing()` | Calculates subtotal, sale discount, coupon discount, shipping fee, and total. |

### Payment Functions

| Function/Route | Description |
|---|---|
| `POST /api/payments/create-gcash-checkout` | Creates PayMongo checkout session for GCash, Maya, Debit, or Credit. |
| `POST /api/payments/webhook` | Receives PayMongo payment events and updates orders. |
| `GET /api/payments/status/:id` | Retrieves payment/order payment status. |

### Messaging and AI Functions

| Function/Route | Description |
|---|---|
| `GET /api/messages` | Retrieves conversations/messages. |
| `POST /api/messages` | Sends admin/customer message. |
| `PATCH /api/messages/conversations/:id/archive` | Archives conversation. |
| `PATCH /api/messages/conversations/:id/restore` | Restores conversation. |
| `DELETE /api/messages/conversations/:id` | Deletes conversation to trash. |
| `POST /api/chat` | Generates AI chatbot response using configured AI provider. |
| `openai.js` | Sends prompt to OpenAI chat completions API. |

### Notifications and Broadcast Functions

| Function/Route | Description |
|---|---|
| `GET /api/notifications` | Retrieves notifications with role-specific visibility. |
| `PATCH /api/notifications/read-all` | Marks notifications read. |
| `PATCH /api/notifications/read-type/:type` | Marks notification type read. |
| `PATCH /api/notifications/:id/read` | Marks one notification read and updates delivery click/open stats. |
| `GET /api/broadcasts` | Admin retrieves broadcasts and analytics. |
| `POST /api/broadcasts` | Admin creates draft/scheduled/sent broadcast. |
| `PUT /api/broadcasts/:id` | Admin updates broadcast. |
| `POST /api/broadcasts/generate` | Generates AI marketing message. |
| `POST /api/broadcasts/:id/resend` | Resends broadcast. |
| `POST /api/broadcasts/:id/duplicate` | Duplicates broadcast. |
| `DELETE /api/broadcasts/:id` | Soft-deletes broadcast. |
| `PATCH /api/broadcasts/:id/restore` | Restores deleted broadcast. |
| `GET /api/broadcasts/sales/active` | Customer retrieves active sale promotions. |

### Reviews, Returns, Reports, and Settings Functions

| Function/Route | Description |
|---|---|
| `GET /api/reviews` | Retrieves reviews/feedback. |
| `POST /api/reviews` | Customer submits review. |
| `GET /api/returns` | Retrieves returns by role. |
| `POST /api/returns` | Customer submits return/refund request. |
| `PATCH /api/returns/:id/decision` | Admin approves/rejects/refunds return. |
| `GET /api/reports/summary` | Retrieves dashboard summary metrics. |
| `GET /api/reports/sales` | Retrieves sales report data. |
| `GET /api/reports/inventory` | Retrieves inventory report data. |
| `GET /api/settings/public` | Retrieves public shop/payment settings. |
| `GET /api/settings/promotions` | Retrieves active coupons/sales/shipping info. |
| `POST /api/settings/coupons/validate` | Validates coupon against selected items. |
| `GET /api/settings` | Retrieves admin settings. |
| `PUT /api/settings` | Updates system settings. |
| `POST /api/settings/reset` | Resets settings. |
| `POST /api/settings/clear-demo-data` | Clears demo business data only. |
| `GET /api/settings/backup` | Exports backup data. |
| `POST /api/settings/restore` | Restores settings/data backup. |
| `GET /api/settings/logs` | Retrieves system logs. |

### Real-Time Socket Functions

| Event | Description |
|---|---|
| `notification:new` | Sends new notification to user/admin interface. |
| `order:new` | Notifies admin of new order. |
| `product:new` | Notifies frontend of new product. |
| `product:update` | Notifies frontend of updated product. |
| `inventory:update` | Broadcasts stock/product inventory changes. |
| `broadcast:progress` | Sends campaign delivery progress to admin. |
| `conversation:join` | Joins a conversation room. |
| `typing` | Sends typing indicator. |
| `user:activity` | Updates active user status. |
| `user:status` | Broadcasts online/offline customer status to admin. |

## 13. System Requirements

### Hardware Requirements

| Component | Minimum Requirement | Recommended Requirement |
|---|---|---|
| Processor | Dual-core processor | Quad-core processor or higher |
| Memory | 4 GB RAM | 8 GB RAM or higher |
| Storage | 2 GB free space | 10 GB or higher for uploads and backups |
| Display | 1366x768 | 1920x1080 or higher |
| Barcode Scanner | Keyboard-emulation scanner | USB/2D barcode scanner with keyboard input mode |
| Printer | Standard printer | A4/bond-paper compatible printer |

### Software Requirements

| Software | Requirement |
|---|---|
| Operating System | Windows, macOS, or Linux |
| Node.js | Node.js 18 or later recommended |
| Package Manager | npm |
| Database | MySQL or MariaDB |
| Browser | Modern Chromium, Firefox, or Edge |
| Backend Dependencies | Express, mysql2, bcryptjs, jsonwebtoken, socket.io, zod, multer, helmet |
| Frontend Dependencies | React, Vite, Tailwind CSS, Axios, Framer Motion, Chart.js, Recharts |

### Browser Requirements

- Google Chrome, Microsoft Edge, Mozilla Firefox, or equivalent modern browser.
- JavaScript enabled.
- Local storage enabled for per-user theme preferences.
- Pop-up permission for printing barcode/report windows.

### Internet Requirements

- Required for PayMongo online payments.
- Required for OpenAI AI chatbot and AI broadcast generation.
- Required for email/SMS OTP delivery.
- Required for hosted deployment and multi-user access.
- Local network access is sufficient for offline/local testing except external integrations.

## 14. User Manual Summary

### Admin Guide

1. Log in using an admin account.
2. Review Dashboard for business summary.
3. Open Inventory to add apparel products.
4. Fill in product name, brand, category, size, condition, price, stock, description, and image.
5. Save product; system generates SKU/barcode automatically.
6. Use Apparel Catalog to view inventory products as product cards.
7. Use Inventory Barcodes to select and print barcode labels.
8. Monitor Orders and update order status/tracking.
9. Manage Customers and account statuses.
10. Open Conversations to handle customer messages or AI chatbot takeover.
11. Use Broadcasts to send announcements, promo codes, and sale promotions.
12. Review Feedback and Returns.
13. Generate Reports and review Analytics.
14. Use Settings to configure shop profile, payment, shipping, coupons, AI, appearance, dark mode, and deployment data management.
15. Use Archive and Trash Bin from Settings Data Management to restore or permanently remove records.

### Customer Guide

1. Register an account and verify OTP.
2. Log in to the customer portal.
3. Browse Shop and filter/search apparel.
4. Open Product Details to review item information.
5. Add item to Cart or use Buy Now.
6. Select cart items for checkout.
7. Enter coupon code if available.
8. Choose payment method.
9. Review checkout summary and confirm order.
10. Complete online payment if using GCash, Maya, Debit, or Credit.
11. Monitor order status in Orders.
12. Open Notifications for broadcasts, promos, order updates, and system messages.
13. Use Messages/AI Chatbot for inquiries.
14. Submit feedback or return requests when needed.
15. Manage profile, password, and personal dark mode in Settings/Profile.

## Documentation Notes

- This document is based on the implemented RETELA codebase as of June 3, 2026.
- The current database implementation is MySQL/MariaDB. MongoDB is not used in the current source code.
- Inventory is the source of truth for product, stock, and barcode data.
- Apparel Catalog and Customer Shop are display/commerce surfaces backed by inventory records.
