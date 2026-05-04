# TapPay GH — Backend API

Ghana NFC Mobile Money Payment System — Node.js/Express Backend

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your credentials

# 3. Run database migration
npm run migrate

# 4. Seed test data (optional)
npm run seed

# 5. Start development server
npm run dev
```

Server runs on `http://localhost:3000`

---

## API Overview

| Base Path | Description |
|---|---|
| `POST /api/auth/register` | Register new user |
| `POST /api/auth/login` | Login |
| `POST /api/auth/refresh` | Refresh access token |
| `GET /api/users/me` | Get current user |
| `POST /api/merchants/register` | Register as merchant |
| `GET /api/merchants/dashboard` | Merchant stats |
| `POST /api/payments/nfc-session` | Create NFC session (merchant) |
| `POST /api/payments/initiate` | Initiate payment (customer) |
| `GET /api/payments/status/:id` | Poll payment status |
| `GET /api/transactions/my` | Customer transaction history |
| `GET /api/transactions/merchant` | Merchant transaction history |
| `POST /api/webhooks/momo` | MTN MoMo callback |
| `POST /api/webhooks/ghipss` | GhIPSS callback |
| `POST /api/webhooks/test` | Test webhook (dev only) |
| `GET /api/admin/stats` | Platform stats (admin) |

---

## Payment Flow

```
1. Merchant POSTs /api/payments/nfc-session { amount }
   → Returns sessionToken + nfcPayload

2. Merchant app writes nfcPayload to NFC tag

3. Customer taps phone → reads NFC tag

4. Customer app POSTs /api/payments/initiate { sessionToken, customerPhone }
   → Detects network (MTN/Telecel/AirtelTigo)
   → Routes to MTN MoMo API or GhIPSS
   → Returns { transactionId, referenceId, status: "processing" }

5. Customer approves on their phone (MoMo PIN prompt)

6. MTN/GhIPSS POSTs to /api/webhooks/momo or /api/webhooks/ghipss
   → Backend confirms transaction
   → WebSocket emits to merchant + customer rooms

7. Both phones show success/failure in real time
```

---

## WebSocket Events

Connect: `socket.emit('join_room', 'merchant-{merchantId}')`

| Event | Direction | Payload |
|---|---|---|
| `payment_initiated` | Server → Merchant | `{ transactionId, amount, status }` |
| `payment_successful` | Server → Both | `{ transactionId, amount, status }` |
| `payment_failed` | Server → Both | `{ transactionId, reason }` |

---

## Network Detection

| Prefix | Network | Gateway |
|---|---|---|
| 024, 054, 055, 059 | MTN | MTN MoMo API |
| 020, 050 | Telecel | GhIPSS |
| 026, 027, 056, 057 | AirtelTigo | GhIPSS |

---

## Test Accounts (after seed)

| Role | Phone | Password |
|---|---|---|
| Admin | 0244000000 | Admin@1234 |
| Merchant | 0241234567 | Test@1234 |
| Customer | 0201234567 | Test@1234 |

---

## Environment Variables

See `.env.example` for full list. Key ones:

- `MTN_COLLECTION_SUBSCRIPTION_KEY` — from momodeveloper.mtn.com
- `GHIPSS_API_KEY` — from GhIPSS partnership
- `JWT_SECRET` — generate a strong random string
- `FIREBASE_*` — from Firebase console (for push notifications)
