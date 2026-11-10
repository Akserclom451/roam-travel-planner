# ROAM — Travel Planner

> A thoughtful travel planning application for unhurried days, pairing curated itineraries and bespoke activities with a secure, verified Razorpay Test Mode checkout experience.

---

## 1. Project Overview

ROAM is an AI-assisted travel planner designed to curate calm, immersive journeys across domestic and international destinations. It guides travellers from interest discovery and itinerary customization through traveller detail collection and final booking confirmation.

Key application highlights:
- **Curated Travel Discovery:** Itineraries across cultural, nature, food, and heritage destinations (e.g., Jaipur, Kyoto, Provence).
- **Custom Itinerary Planning:** Interactive schedule customizer, activity additions, and real-time cost calculation.
- **Dynamic Currency Support:** Transparent pricing in INR (`₹`), USD (`$`), and EUR (`€`).
- **Resilient Booking & Checkout:** Full Razorpay Test Mode checkout lifecycle featuring guest checkout, bank decline simulation handling, and instant verified booking confirmation.
- **Hardened Security Architecture:** Server-side HMAC SHA-256 signature verification, captured-only payment status enforcement, strict receipt/notes validation, route-level rate limiting, and configurable proxy trust.

---

## 2. Technology Stack & Architecture

- **Frontend:** React 19, TypeScript, Tailwind CSS, Lucide React icons, Vite.
- **Backend:** Node.js, Express, TypeScript (`tsx` in development, `esbuild` for production).
- **Payment Gateway Integration:** Razorpay Test Mode via `@razorpay/razorpay` Node.js SDK and Razorpay Checkout JS (`checkout.razorpay.com/v1/checkout.js`).
- **Validation & Security:** Node.js native `crypto` (HMAC SHA-256), `express-rate-limit`, strict IP address parser / CIDR validator.
- **Testing:** Vitest, Supertest, React Testing Library.

### Architecture Diagram

```
+------------------------------------------------------------------------+
|                          ROAM React Client (Vite)                       |
|  - Itinerary Planner & Customizer                                      |
|  - Guest Checkout Modal (Razorpay Checkout.js)                         |
|  - Booking Confirmation & Receipt Viewer                               |
+-----------------------------------+------------------------------------+
                                    |
          1. GET /api/razorpay/config (Fetch public Key ID)
          2. POST /api/razorpay/order (Create order with itinerary details)
          3. Client launches Razorpay Modal & completes sandbox payment
          4. POST /api/razorpay/verify (Submit payment credentials)
                                    |
                                    v
+------------------------------------------------------------------------+
|                        ROAM Server (Express)                           |
|                                                                        |
|  [Rate Limiter & Proxy Trust]                                          |
|    - Validates client IP via strict `parseTrustProxy` rules            |
|    - Guards order creation (20 req/15m) & verification (30 req/15m)    |
|                                                                        |
|  [Order Creation Handler: POST /api/razorpay/order]                    |
|    - Server-side currency & amount conversion (paise/cents)            |
|    - Enforces receipt format: roam_rcpt_<timestamp>_<rand>             |
|    - Calls Razorpay Orders API via server-side credentials             |
|                                                                        |
|  [Payment Verification Handler: POST /api/razorpay/verify]             |
|    - Validates HMAC SHA-256 signature against RAZORPAY_KEY_SECRET      |
|    - Fetches payment details from Razorpay Payments API                |
|    - Enforces payment status === "captured" (S3-01)                    |
|    - Enforces order receipt & note correlation (S3-03)                 |
+-----------------------------------+------------------------------------+
                                    |
          Calls Razorpay REST APIs using Key ID & Key Secret
                                    v
+------------------------------------------------------------------------+
|                      Razorpay Sandbox API Service                      |
+------------------------------------------------------------------------+
```

---

## 3. Repository Structure

```
roam/
├── client/                     # Frontend client codebase
│   ├── index.html              # HTML entry point (fonts, title, scripts)
│   └── src/
│       ├── components/         # React components (CheckoutModal, Itinerary, etc.)
│       ├── hooks/              # Custom React hooks (useRazorpay, useItinerary)
│       ├── lib/                # Client utilities and helpers
│       ├── types/              # Client TypeScript type definitions
│       ├── App.tsx             # Main application component
│       ├── main.tsx            # React application root
│       └── index.css           # Tailwind CSS imports & global styles
├── server/                     # Backend server codebase
│   ├── razorpay.ts             # Razorpay router, order creation & verification logic
│   ├── razorpay.test.ts        # Unit and integration tests for payment endpoints
│   ├── server.test.ts          # Server routing and static serving integration tests
│   └── test-helpers.ts         # Mock factory and test fixtures
├── shared/                     # Shared types and data schemas across client and server
│   └── schema.ts               # Order request/response contracts and payment schemas
├── server.ts                   # Express server entry point (Vite dev middleware & prod static)
├── vite.config.ts              # Vite configuration
├── tsconfig.json               # TypeScript compiler configuration
├── vitest.config.ts            # Vitest test runner configuration
└── package.json                # Project dependencies and npm scripts
```

---

## 4. Environment Variables

Create or configure your `.env` file based on `.env.example`:

| Variable | Required | Default (Dev) | Description |
| :--- | :--- | :--- | :--- |
| `RAZORPAY_KEY_ID` | **Yes** | None | Razorpay Test Mode Key ID (e.g., `rzp_test_...`). Exposed publicly to client via `/api/razorpay/config`. |
| `RAZORPAY_KEY_SECRET` | **Yes** | None | Razorpay Test Mode Key Secret. **Must remain strictly confidential on the server**. Never sent to the client. |
| `TRUST_PROXY` | No | `false` | Reverse proxy trust configuration for Express rate limiting. |
| `PORT` | No | `3000` | HTTP port on which the Express server listens. |
| `NODE_ENV` | No | `development`| Environment mode (`development` or `production`). |

### `TRUST_PROXY` Configuration Rules
Express rate limiting relies on `req.ip`. To prevent IP spoofing vulnerabilities, `TRUST_PROXY` is validated strictly by `parseTrustProxy`:
- `false` (default): Direct connections without reverse proxy.
- Integer `N` (e.g. `TRUST_PROXY=2`): Trust exactly `N` reverse proxy hops (required in AI Studio hosted container environments where requests traverse internal proxies).
- Specific IP or comma-separated list/CIDR (e.g. `127.0.0.1`, `10.0.0.0/8`): Trusts only listed upstream proxies.
- **Strictly Rejected:** Values `"true"` and `"all"` throw descriptive configuration errors at server startup to prevent permissive trust misconfigurations.

---

## 5. Development & Production Commands

### Installation
```bash
npm install
```

### Development Server
Starts the Express server with Vite middleware mode on port 3000:
```bash
npm run dev
```

### Production Build
Builds the client assets into `dist/public` and bundles `server.ts` into `dist/server.js`:
```bash
npm run build
```

### Production Run
Runs the bundled production server:
```bash
npm start
# or explicitly:
NODE_ENV=production node dist/server.js
```

---

## 6. Testing, Linting & Typecheck Commands

```bash
# Run all unit and integration test suites
npm test

# Run Vitest in watch mode
npx vitest

# Run TypeScript compiler check without emitting output
npx tsc --noEmit

# Run ESLint validation
npm run lint
```

---

## 7. Razorpay Test Mode Setup

1. Sign up or log in to the [Razorpay Dashboard](https://dashboard.razorpay.com/).
2. Toggle the dashboard to **Test Mode** (orange banner at top).
3. Navigate to **Account & Settings** -> **API Keys**.
4. Generate a Test Key pair. You will receive:
   - A **Key ID** (starts with `rzp_test_`)
   - A **Key Secret** (alphanumeric string)
5. Add both keys to your `.env` file:
   ```env
   RAZORPAY_KEY_ID=rzp_test_YourTestKeyIdHere
   RAZORPAY_KEY_SECRET=YourTestKeySecretHere
   TRUST_PROXY=false
   ```
6. Restart the development or production server.

---

## 8. Payment Testing Guide

All testing is performed safely in **Razorpay Sandbox / Test Mode**.

### A. Netbanking Sandbox Flow (Recommended Baseline)
1. Select an itinerary (e.g., Jaipur, INR ₹3,179).
2. Enter traveller details and proceed to checkout.
3. In the Razorpay modal, select **Netbanking**.
4. Choose any test bank (e.g., HDFC, ICICI, SBI).
5. On the Razorpay bank simulator screen:
   - Click **Success** to verify the full confirmation flow.
   - Click **Failure** to verify the bank decline handling without breaking the ROAM session.

### B. Card Sandbox Testing
- Razorpay sandbox card payments require valid test cards configured in the merchant's sandbox profile.
- **Guest Checkout:** To avoid OTP / phone verification prompts in sandbox mode, uncheck "Save this card securely" when testing.
- **Domestic INR vs International:** Standard Razorpay test accounts have domestic cards enabled by default. If a test card triggers an "International cards are not supported" notice, use domestic test card numbers provided in the Razorpay sandbox documentation or test via Netbanking or UPI.

### C. UPI Sandbox Testing
- In the Razorpay modal, select **UPI / QR**.
- Enter the official Razorpay test UPI ID:
  ```text
  success@razorpay
  ```
- Click **Pay Now**. Razorpay will immediately simulate a successful UPI transaction and redirect back to the ROAM confirmation screen.

---

## 9. Payment Verification Architecture

Payment security in ROAM is multi-tiered and server-authoritative:

1. **Client Submission:** The frontend receives `razorpay_payment_id`, `razorpay_order_id`, and `razorpay_signature` from the Razorpay modal and submits them to `POST /api/razorpay/verify`.
2. **Cryptographic HMAC SHA-256 Verification:**
   The backend independently computes:
   $$\text{expected\_signature} = \text{HMAC-SHA256}(\text{order\_id} + "|" + \text{payment\_id}, \text{RAZORPAY\_KEY\_SECRET})$$
   The received signature is compared using timing-safe comparison (`crypto.timingSafeEqual`).
3. **Live SDK Status Verification:**
   The backend queries the Razorpay API directly using `@razorpay/razorpay` to fetch the payment record:
   - Confirms `payment.order_id === razorpay_order_id`.
   - Confirms `payment.amount` matches the expected amount.
4. **Receipt Generation:** Once verified, a booking confirmation record with a unique confirmation code (`ROAM-...`) is returned to the client and displayed on the receipt screen.

---

## 10. Security Protections & Audits

| Security Check | Implementation Details |
| :--- | :--- |
| **S3-01: Captured-Only Enforcement** | Payments with status `"authorized"` or `"pending"` are rejected by `POST /api/razorpay/verify`. Only status `"captured"` is accepted for booking completion. |
| **S3-02: Rate Limiting & Trust Proxy** | Strict rate limits prevent brute force: order creation is limited to 20 requests / 15 min; payment verification is limited to 30 requests / 15 min. Upstream proxies are validated via `parseTrustProxy`. |
| **S3-03: Receipt & Notes Correlation** | Order creation creates receipts matching `roam_rcpt_<timestamp>_<random>`. Verification confirms the order and notes correspond to an authentic ROAM session. |
| **API Secret Isolation** | `RAZORPAY_KEY_SECRET` is strictly contained within backend server memory. Client builds (`npm run build`) and the public `/api/razorpay/config` endpoint expose only `key_id`. |
| **Timing-Safe Signatures** | Signature verification uses `crypto.timingSafeEqual` over SHA-256 digests to prevent timing attacks. |

---

## 11. Known Sandbox Limitations

- **Simulated Inventory:** Bookings created in Test Mode do not reserve live airline or hotel inventory. Confirmation receipts are generated for application demonstration.
- **Merchant Sandbox Settings:** Certain payment methods (e.g. international cards, EMI, or specific wallets) depend on feature toggles inside the individual Razorpay Merchant Dashboard under *Settings -> Payment Methods*. Netbanking and UPI (`success@razorpay`) are always available in Test Mode.
- **Public Key Exposure:** Only the Razorpay Test Key ID is shared with the client browser, which is the standard Razorpay client-side integration model.
