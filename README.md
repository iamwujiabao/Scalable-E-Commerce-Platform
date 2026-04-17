# 🛒 Scalable E-Commerce Platform — Microservices Architecture

A production-ready e-commerce backend built with **Node.js**, **Docker**, and a full microservices stack. Each domain is an independent service with its own database, communicating via REST APIs and an async message bus.

---

## 📐 Architecture Overview

```
                          ┌─────────────────────────────────────┐
         Clients          │           API Gateway (NGINX)        │  :80 / :443
  (Web / Mobile / API) ──▶│  Rate limiting · Routing · TLS       │
                          └──────┬──────┬──────┬──────┬──────────┘
                                 │      │      │      │
             ┌───────────────────┘      │      │      └────────────────────┐
             ▼                          ▼      ▼                           ▼
    ┌─────────────────┐    ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐
    │  User Service   │    │ Product Service │  │ Cart Service │  │  Order Service   │
    │   :3001         │    │   :3002         │  │   :3003      │  │   :3004          │
    │  PostgreSQL     │    │  PostgreSQL     │  │   Redis      │  │  PostgreSQL      │
    └────────┬────────┘    └────────┬────────┘  └──────┬───────┘  └───────┬──────────┘
             │                      │                   │                  │
             └──────────────────────┴───────────────────┴──────────────────┘
                                                │
                                   ┌────────────▼────────────┐
                                   │   RabbitMQ Message Bus  │
                                   │  (topic exchange)       │
                                   └───┬────────────┬────────┘
                                       │            │
                             ┌─────────▼──┐  ┌──────▼──────────────┐
                             │  Payment   │  │  Notification        │
                             │  Service  │  │  Service             │
                             │  :3005    │  │  :3006               │
                             │  Stripe   │  │  SendGrid + Twilio   │
                             └───────────┘  └──────────────────────┘

    Monitoring: Prometheus :9090 · Grafana :3000
    Management: RabbitMQ UI :15672
```

---

## 🗂️ Project Structure

```
ecommerce-platform/
├── api-gateway/              # NGINX reverse proxy & rate limiter
│   ├── nginx.conf
│   └── Dockerfile
├── user-service/             # Auth, JWT, profiles, addresses
│   └── src/
│       ├── controllers/
│       ├── routes/
│       ├── middleware/
│       ├── messaging/
│       └── utils/
├── product-service/          # Catalog, categories, inventory
├── cart-service/             # Redis-backed shopping cart
├── order-service/            # Order lifecycle & status history
├── payment-service/          # Stripe PaymentIntents & webhooks
├── notification-service/     # Email (SendGrid) & SMS (Twilio)
├── monitoring/
│   ├── prometheus/
│   │   └── prometheus.yml
│   └── grafana/
│       └── dashboards/
├── .github/
│   └── workflows/
│       └── ci-cd.yml         # GitHub Actions CI/CD
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
| Tool            | Version  |
|-----------------|----------|
| Docker          | ≥ 24.0   |
| Docker Compose  | ≥ 2.20   |
| Node.js (local) | ≥ 20 LTS |

### 1 — Clone & configure

```bash
git clone https://github.com/your-org/ecommerce-platform.git
cd ecommerce-platform

# Create your environment file
cp .env.example .env
# Edit .env and fill in all CHANGE_ME values
```

### 2 — Start everything

```bash
# Build images and start all services
docker compose up --build -d

# Follow logs
docker compose logs -f

# Check all services are healthy
docker compose ps
```

### 3 — Verify

```bash
curl http://localhost/health
# → {"status":"ok","service":"api-gateway"}

curl http://localhost/api/v1/products
# → {"data":[...],"pagination":{...}}
```

### 4 — Open monitoring dashboards

| Service         | URL                      | Credentials           |
|-----------------|--------------------------|-----------------------|
| Grafana         | http://localhost:3000     | admin / grafana_secret |
| Prometheus      | http://localhost:9090     | —                     |
| RabbitMQ UI     | http://localhost:15672    | rabbit_user / rabbit_secret |

---

## 📡 API Reference

All endpoints are prefixed with `/api/v1` and routed through the gateway on **port 80**.

### Authentication
```
POST /auth/register    Register a new user
POST /auth/login       Login → returns accessToken + refreshToken
POST /auth/refresh     Rotate refresh token
POST /auth/logout      Invalidate refresh token
GET  /auth/me          Get current user profile
```

### Users
```
GET    /users/profile          Get own profile
PATCH  /users/profile          Update profile
GET    /users/addresses        List addresses
POST   /users/addresses        Add address
DELETE /users/addresses/:id    Remove address
```

### Products
```
GET    /products               List products (search, filter, paginate, sort)
GET    /products/featured      Featured products
GET    /products/:id           Product detail + images + inventory + attributes
POST   /products               Create product       [admin/vendor]
PATCH  /products/:id           Update product       [admin/vendor]
DELETE /products/:id           Soft-delete product  [admin]
PATCH  /products/:id/inventory Update stock level   [admin/vendor]
POST   /products/:id/images    Add product image    [admin/vendor]
```

### Categories
```
GET    /categories        List all active categories with product counts
GET    /categories/:slug  Category detail
POST   /categories        Create category  [admin]
PATCH  /categories/:id    Update category  [admin]
```

### Cart
```
GET    /cart                      Get current cart
POST   /cart/items                Add item (validates stock in real-time)
PATCH  /cart/items/:productId     Update quantity
DELETE /cart/items/:productId     Remove item
DELETE /cart                      Clear cart
GET    /cart/checkout-summary     Subtotal + tax + shipping preview
```

### Orders
```
POST   /orders              Place an order (validates stock, calculates totals)
GET    /orders              List own orders (admin sees all)
GET    /orders/:id          Order detail + items + status history
PATCH  /orders/:id/status   Update status  [admin]
POST   /orders/:id/cancel   Cancel order
```

### Payments
```
POST   /payments/intent          Create Stripe PaymentIntent → clientSecret
POST   /payments/confirm         Confirm payment server-side
POST   /payments/refund          Issue refund  [admin]
GET    /payments/:intentId       Get payment details
POST   /webhooks/stripe          Stripe webhook receiver
```

---

## 🔐 Authentication Flow

```
1. POST /auth/register  ──▶  { accessToken, refreshToken }
2. GET  /api/v1/...         Authorization: Bearer <accessToken>
3. POST /auth/refresh  ──▶  { accessToken, refreshToken }  ← rotate on expiry
4. POST /auth/logout        Revokes refreshToken server-side
```

Access tokens are short-lived JWTs (`15m` default). Refresh tokens are SHA-256-hashed before storage and rotated on every use.

---

## 📨 Event Bus (RabbitMQ)

All services communicate asynchronously through a **topic exchange** named `ecommerce`.

| Routing Key          | Publisher            | Subscribers                         |
|----------------------|----------------------|-------------------------------------|
| `user.registered`    | User Service         | Notification Service                |
| `order.placed`       | Order Service        | Product Service, Notification Svc   |
| `order.confirmed`    | Order Service        | Notification Service                |
| `order.shipped`      | Order Service        | Notification Service                |
| `order.delivered`    | Order Service        | Notification Service                |
| `order.cancelled`    | Order Service        | Notification Service                |
| `payment.completed`  | Payment Service      | Order Service, Notification Svc     |
| `payment.failed`     | Payment Service      | Order Service, Notification Svc     |
| `payment.refunded`   | Payment Service      | Notification Service                |
| `inventory.updated`  | Product Service      | (extensible)                        |

Failed messages are nacked to a **Dead-Letter Exchange** after one retry for manual inspection.

---

## 💳 Payment Flow

```
Frontend                    API Gateway          Payment Service         Stripe
   │                              │                     │                   │
   │── POST /orders ─────────────▶│── order-service ───▶│                   │
   │◀─ { orderId, total } ────────│                     │                   │
   │                              │                     │                   │
   │── POST /payments/intent ────▶│────────────────────▶│── createIntent ──▶│
   │◀─ { clientSecret } ──────────│◀────────────────────│◀─ { secret } ─────│
   │                              │                     │                   │
   │── confirmCardPayment() ───────────────────────────────────────────────▶│
   │                              │                     │                   │
   │                              │         Stripe webhook (payment_intent.succeeded)
   │                              │                     │◀──────────────────│
   │                              │                     │── publishEvent ───▶ RabbitMQ
   │                              │                                          │
   │                              │    order-service ◀── payment.completed ──│
   │                              │    (sets order status = confirmed)        │
```

---

## 🔧 Configuration

Each service reads configuration from environment variables. See `.env.example` for the full list.

### Key variables per service

| Variable              | Service         | Description                          |
|-----------------------|-----------------|--------------------------------------|
| `JWT_SECRET`          | All             | Shared JWT signing secret            |
| `DB_HOST/USER/PASS`   | User/Product/Order | PostgreSQL connection              |
| `REDIS_URL`           | Cart            | Redis connection string              |
| `RABBITMQ_URL`        | All             | AMQP connection string               |
| `STRIPE_SECRET_KEY`   | Payment         | Stripe secret key                    |
| `STRIPE_WEBHOOK_SECRET` | Payment       | Stripe webhook signing secret        |
| `SMTP_*`              | Notification    | SendGrid SMTP credentials            |
| `TWILIO_*`            | Notification    | Twilio SMS credentials               |

---

## 📦 Docker Images

Each service uses a **multi-stage Dockerfile**:

| Stage   | Purpose                                      |
|---------|----------------------------------------------|
| `base`  | Node 20 Alpine + wget for health checks      |
| `deps`  | `npm ci --only=production` (cached layer)    |
| `final` | Copy deps + source, drop to non-root user    |

All containers run as a **non-root user** (`appuser`). Health checks are built into each image.

---

## 📊 Monitoring

### Prometheus Metrics
Every service exposes `/metrics` in Prometheus format via `prom-client`:
- `http_requests_total` — request count by method, route, status
- `http_request_duration_seconds` — latency histogram
- `nodejs_heap_size_used_bytes` — memory usage
- Default Node.js runtime metrics

### Grafana Dashboards
Pre-provisioned dashboard at startup includes:
- HTTP request rates per service
- Error rate percentage
- P99 latency heatmap
- Memory usage per instance
- RabbitMQ queue depth
- Service health status grid

---

## 🔄 CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci-cd.yml`) runs on every push:

```
Push to develop/main
       │
       ▼
   Detect changed services (paths-filter)
       │
       ▼
   Test matrix (parallel per service)
   ├── Install deps
   ├── Lint
   ├── Unit + Integration tests
   └── Upload coverage to Codecov
       │
       ▼
   Build & push Docker images to GHCR
   (tagged: branch-sha, branch, latest on main)
       │
       ├── develop ──▶ Deploy to staging (rolling)
       │                     │
       │               Smoke tests
       │
       └── main ────▶ Deploy to production (service-by-service)
                             │
                       Post-deploy health checks
                             │
                       Slack alert on failure
```

---

## 🛠️ Development Tips

### Run a single service locally

```bash
cd user-service
npm install
cp ../.env.example .env   # edit values
npm run dev               # nodemon hot-reload
```

### Rebuild one service without restarting others

```bash
docker compose up --build --no-deps user-service
```

### View logs for a specific service

```bash
docker compose logs -f order-service
```

### Scale a stateless service

```bash
docker compose up -d --scale product-service=3
```

### Connect to a database

```bash
docker compose exec postgres-user psql -U user_svc -d userdb
```

### Inspect RabbitMQ queues

```
Open http://localhost:15672
Login: rabbit_user / rabbit_secret
```

### Trigger a Stripe webhook locally

```bash
stripe listen --forward-to localhost/api/v1/webhooks/stripe
```

---

## 🔒 Security Considerations

- **JWT**: Short-lived access tokens (15 min), refresh token rotation & revocation
- **Passwords**: bcrypt with cost factor 12
- **Rate limiting**: NGINX limits auth endpoints to 10 req/min, API to 60 req/min
- **Helmet**: Security headers on every service
- **Non-root containers**: All Docker images drop to `appuser`
- **Secrets**: Never hardcoded — loaded from environment / Docker secrets
- **Stripe**: Webhook signature verification on every incoming event

---

## 📈 Scaling Strategies

| Layer              | Strategy                                              |
|--------------------|-------------------------------------------------------|
| Stateless services | Horizontal scaling via `docker compose scale`         |
| Database           | Read replicas, connection pooling (pg-pool)           |
| Cache              | Redis cluster for cart + session data                 |
| Message queue      | RabbitMQ clustering with mirrored queues              |
| API Gateway        | NGINX upstream `least_conn` load balancing            |
| Production         | Migrate to Kubernetes + HPA for auto-scaling          |

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit changes: `git commit -m 'feat: add my feature'`
4. Push: `git push origin feat/my-feature`
5. Open a Pull Request against `develop`

---

## 📄 License

MIT © Your Organization
