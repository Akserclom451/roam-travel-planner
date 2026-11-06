# S3-02 Proxy Trust & Client IP Configuration Implementation Plan

## Summary
Correct the Express proxy-trust configuration in `server.ts` to replace the hardcoded `app.set("trust proxy", 1)` with an environment-aware, robustly validated parser (`parseTrustProxy`). This ensures accurate client IP identification for rate limiting across AI Studio hosted development, local environments, and production deployments without blindly guessing topology or exposing endpoints to `X-Forwarded-For` spoofing.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Production Deployment Topology Must Be Declared, Not Guessed.**
> The ROAM repository contains no container orchestration or reverse-proxy manifests for production (`package.json` runs Node directly). 
> - In development (`NODE_ENV !== "production"`), the proxy chain is confirmed: Cloud Run GFE $\rightarrow$ Container NGINX $\rightarrow$ Node (2 hops).
> - In production, topology varies widely: Cloud Run standalone (1 hop), Cloudflare + Cloud Run/ALB (2 hops), or direct VPS exposure (0 hops / disabled).
> - **Decision**: If `TRUST_PROXY` is not defined in production, the application will fail safely by defaulting to `false` (zero trust, using socket IP only) and logging an advisory warning, or failing fast on startup with an explicit descriptive error.

---

## 1. Environment-Specific Proxy Trust Requirements

| Environment | Topology | Required `trust proxy` Setting | Rationale |
| :--- | :--- | :--- | :--- |
| **AI Studio Hosted Dev** | Cloud Run GFE $\rightarrow$ Container NGINX $\rightarrow$ Node | `2` | Hop 1 is local NGINX (`127.0.0.1`); Hop 2 is Cloud Run GFE (`169.254.x.x`). Peeling 2 hops resolves the real browser client IP. |
| **Local Dev (Direct / NGINX)** | Local NGINX $\rightarrow$ Node (or direct Vite dev) | `"loopback"` or `1` | Trusts only connections originating from `127.0.0.1` / `::1`. Direct connections cannot spoof headers. |
| **Production** | Explicitly configured via `TRUST_PROXY` | Variable (e.g. `1`, `2`, `"loopback"`, or `false`) | Avoids blind trust. Must be explicitly provided by the hosting environment. |

---

## 2. Technical Architecture & Parsing Specification

### A. Parsing Logic (`parseTrustProxy`)

The parser will be implemented in `server/razorpay.ts` (or imported utility) and used in `server.ts`:

```typescript
export function parseTrustProxy(
  rawVal: string | undefined,
  isProduction: boolean
): boolean | number | string | string[] {
  if (rawVal !== undefined && rawVal.trim() !== "") {
    const trimmed = rawVal.trim().toLowerCase();

    // 1. Explicit disable: "0", "false", "off", "none" -> boolean false
    if (trimmed === "false" || trimmed === "0" || trimmed === "off" || trimmed === "none") {
      return false;
    }

    // 2. Explicit full trust: "true", "all" -> boolean true
    if (trimmed === "true" || trimmed === "all") {
      return true;
    }

    // 3. Numeric hop count: "1", "2", etc. -> integer number
    if (/^\d+$/.test(trimmed)) {
      const hops = parseInt(trimmed, 10);
      if (!Number.isFinite(hops) || hops < 0) {
        throw new Error(
          `Invalid TRUST_PROXY configuration: '${rawVal}'. Hop count must be a non-negative integer.`
        );
      }
      return hops === 0 ? false : hops;
    }

    // 4. Comma-separated subnets or IP lists
    if (trimmed.includes(",")) {
      const subnets = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
      if (subnets.length === 0) {
        throw new Error(
          `Invalid TRUST_PROXY configuration: '${rawVal}'. Subnet list cannot be empty.`
        );
      }
      return subnets;
    }

    // 5. Named subnet string: "loopback", "linklocal", "uniquelocal", or CIDR block
    if (["loopback", "linklocal", "uniquelocal"].includes(trimmed) || trimmed.includes("/")) {
      return trimmed;
    }

    // 6. Any unparseable string fails safely
    throw new Error(
      `Invalid TRUST_PROXY configuration: '${rawVal}'. Supported values: non-negative integer, 'false', 'true', 'loopback', 'linklocal', 'uniquelocal', or CIDR subnets.`
    );
  }

  // Safe defaults when TRUST_PROXY is omitted:
  if (!isProduction) {
    // In AI Studio hosted preview: 2 hops (GFE -> NGINX -> Node)
    return 2;
  }

  // In production without explicit configuration:
  // Fail-safe default is disabled trust (false) to prevent spoofing vulnerability
  return false;
}
```

### B. Spoofing Prevention Explanation

```
[Attacker: 203.0.113.5] 
  Sends Request with Header: "X-Forwarded-For: 198.51.100.99"
       │
       ▼
[Trusted Proxy 1: GFE]
  Appends Attacker TCP Socket: "198.51.100.99, 203.0.113.5"
       │
       ▼
[Trusted Proxy 2: NGINX]
  Appends GFE Remote Address: "198.51.100.99, 203.0.113.5, 169.254.8.1"
       │
       ▼
[Node Server: Express with trust proxy = 2]
  1. Socket remoteAddress = 127.0.0.1 (NGINX) -> Trusted Hop 1
  2. Inspects 169.254.8.1 (GFE)               -> Trusted Hop 2
  3. Inspects 203.0.113.5 (Attacker Real IP)   -> Untrusted! STOPS HERE.
  4. Returns req.ip = 203.0.113.5
  5. Attacker's spoofed "198.51.100.99" is NEVER reached or trusted.
```

If an attacker connects directly to a server with `TRUST_PROXY=false` (0 hops):
- Express ignores `X-Forwarded-For: 198.51.100.99` entirely.
- Returns `req.ip = 203.0.113.5` (the real socket remoteAddress).
- Spoofing is blocked.

---

## 3. Exact Files Needing Modification

1. **`server.ts`**:
   - Replace hardcoded `app.set("trust proxy", 1)` with:
     ```typescript
     const trustProxySetting = parseTrustProxy(process.env.TRUST_PROXY, isProduction);
     app.set("trust proxy", trustProxySetting);
     ```
2. **`server/razorpay.ts`**:
   - Export `parseTrustProxy` helper.
   - Keep existing `getClientIp`, `createRateLimiter`, limits, headers, and error response bodies unchanged.
3. **`server/razorpay.test.ts`**:
   - Add unit tests for `parseTrustProxy` (number parsing, boolean `false`/`0`, subnet strings, and error handling on invalid values).
   - Add integration tests verifying rate limiting under `trust proxy: 2`, `trust proxy: "loopback"`, and `trust proxy: false` with spoofed `X-Forwarded-For` headers.

*No client-side files, UI components, or payment logic will be modified.*

---

## 4. Risks and Limitations

1. **Production Deployment Awareness**:
   - If production is deployed behind a single-hop cloud ingress (e.g. Cloud Run) without setting `TRUST_PROXY=1`, the fail-safe default `false` will cause all incoming requests to share the internal ingress proxy IP for rate limiting.
   - **Mitigation**: Add a prominent startup log when `TRUST_PROXY` is unset in production, and document deployment settings clearly.
2. **CDN Additions (e.g., Cloudflare)**:
   - Introducing an external CDN changes the hop count from 1 to 2. If `TRUST_PROXY` is not updated accordingly, client IP resolution will point to the CDN edge node rather than the client.
3. **Internal Subnet Spoofing**:
   - If `TRUST_PROXY` is set to `true` (trust all hops), any upstream client can forge `X-Forwarded-For`. The parser will specifically disallow `true` as a production default.

---

## 5. Test Plan

### A. Parser Unit Tests (`parseTrustProxy`)
1. **Numeric Hops**:
   - `"1"` $\rightarrow$ `1`
   - `"2"` $\rightarrow$ `2`
   - `"10"` $\rightarrow$ `10`
2. **Disabled Trust**:
   - `"0"` $\rightarrow$ `false`
   - `"false"` $\rightarrow$ `false`
   - `"off"` $\rightarrow$ `false`
3. **Named Subnets**:
   - `"loopback"` $\rightarrow$ `"loopback"`
   - `"loopback,linklocal"` $\rightarrow$ `["loopback", "linklocal"]`
4. **Invalid Input Error Handling**:
   - `"-1"` $\rightarrow$ throws descriptive error
   - `"abc"` $\rightarrow$ throws descriptive error
   - `",,"` $\rightarrow$ throws descriptive error
5. **Environment Defaults**:
   - Unset in dev (`isProduction = false`) $\rightarrow$ returns `2`
   - Unset in prod (`isProduction = true`) $\rightarrow$ returns `false`

### B. Spoofing & Integration Tests
1. **AI Studio Dev Mode (2 hops)**:
   - Request with socket `127.0.0.1` and `X-Forwarded-For: "1.1.1.1, 203.0.113.10, 169.254.8.1"`.
   - Verify rate limiter bucket is keyed to real client `203.0.113.10` and spoofed `1.1.1.1` is ignored.
2. **Direct Exposure / Zero Trust (`false`)**:
   - Request with socket `203.0.113.10` and `X-Forwarded-For: "1.1.1.1"`.
   - Verify rate limiter bucket is keyed to socket IP `203.0.113.10` and spoofed `1.1.1.1` is ignored.
3. **Loopback Trust (`"loopback"`)**:
   - Direct connection from external IP `203.0.113.10` with spoofed `X-Forwarded-For` $\rightarrow$ uses `203.0.113.10`.
   - Proxied connection from `127.0.0.1` with `X-Forwarded-For: "203.0.113.10"` $\rightarrow$ uses `203.0.113.10`.
4. **Endpoint Rate Limit Regression**:
   - Confirm all 117 existing tests (S3-01 captured check, S3-03 validation, and S3-02 limits) continue to pass.
