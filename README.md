# Retela

Retela is an AI-assisted sales and inventory management system for Tela to Pera Thrift Shop. It includes a React + Tailwind frontend, Node.js + Express backend, MySQL database schema, JWT authentication, OTP verification, admin approval, role dashboards, inventory, orders, reports, notifications, feedback, return/refund handling, AI chat, and admin chat takeover.

## 1. Setup

Requirements:

- Node.js 20+
- MySQL or XAMPP/phpMyAdmin
- PowerShell or terminal

Install dependencies:

```bash
cd backend
npm install
cd ../frontend
npm install
```

Create backend environment:

```bash
copy backend\.env.example backend\.env
```

Update `backend/.env` with your MySQL credentials and a strong `JWT_SECRET`.

Optional SMS OTP settings:

```bash
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_FROM_NUMBER=+15551234567
```

You can also use a generic SMS provider that accepts `POST { "to": "...", "message": "..." }`:

```bash
SMS_API_URL=https://your-sms-provider.example/send
SMS_API_TOKEN=your_sms_api_token
```

Password reset OTP requires one of these SMS providers to be configured so codes are sent to real phone numbers.

Optional Gemini chat settings:

```bash
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

If `GEMINI_API_KEY` is missing or Gemini is temporarily unavailable, the chat falls back to the built-in inventory assistant.

## 2. Backend

Run the API:

```bash
cd backend
npm run dev
```

Default API URL: `http://localhost:5000/api`

Important routes:

- `POST /api/auth/register`
- `POST /api/auth/verify-otp`
- `POST /api/auth/password-reset/request`
- `POST /api/auth/password-reset/verify`
- `POST /api/auth/password-reset/complete`
- `POST /api/auth/login`
- `GET/POST/PUT/DELETE /api/products`
- `GET/POST/PATCH /api/orders`
- `GET/POST /api/messages`
- `GET /api/reports/summary`
- `GET/PUT /api/settings`

## 3. Database

Import [database/schema.sql](database/schema.sql) in phpMyAdmin or run it in MySQL.

Seeded admin account:

- Username: `admin`
- Password: `Admin123!`

## 4. Frontend

Run the web app:

```bash
cd frontend
npm run dev
```

Default frontend URL: `http://localhost:5173`

The app includes:

- Animated split-screen login/signup
- OTP verification step
- Admin and customer sidebars
- Product, inventory, order, report, notification, feedback, return/refund, AI chat, and admin message views

## 5. Integration

The frontend reads `VITE_API_URL` and `VITE_SOCKET_URL`.

Create `frontend/.env` if you need custom URLs:

```bash
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

New product creation triggers realtime customer notifications. Admin replies set conversation takeover, and the AI assistant only suggests products and never approves orders.
