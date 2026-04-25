# Time-Off Microservice — ReadyOn Take-Home Challenge

A robust NestJS-based microservice for managing employee time-off requests and leave balances, featuring a **Defensive Design** and seamless synchronization with an external Human Capital Management (HCM) "Source of Truth".

## 🚀 Key Features

- **Defensive Architecture**: Multi-layer local validation ensures balance integrity before any external API calls are made.
- **HCM Synchronization**: 
  - **Real-time Sync**: Triggers during request approval to handle independent HCM changes (e.g., anniversary bonuses).
  - **Batch Sync**: Bulk ingestion endpoint for large-scale balance updates.
- **Source of Truth Pattern**: Implements a "Trust but Verify" approach where HCM is prioritized.
- **Optimistic Locking**: Prevents race conditions during concurrent balance deductions.
- **Comprehensive Testing**: Rigorous unit and E2E test suites with mock HCM simulation.

---

## 🛠️ Tech Stack

- **Framework**: [NestJS](https://nestjs.com/) (TypeScript)
- **Database**: SQLite (via `better-sqlite3`)
- **ORM**: [TypeORM](https://typeorm.io/)
- **Validation**: `class-validator` & `class-transformer`
- **Testing**: [Jest](https://jestjs.io/) & `supertest`

---

## 📦 Installation & Setup

### Prerequisites
- Node.js (v18+)
- npm

### 1. Clone & Install
```bash
git clone <repository-url>
cd time-off-service
npm install
```

### 2. Configure Database
The project uses SQLite. The database file will be automatically created at `data/timeoff.sqlite` upon the first run.

### 3. Run the Application
```bash
# Development mode
npm run start:dev

# Production build
npm run build
npm run start:prod
```
The service will be available at `http://localhost:3000`.

---

## 🧪 Testing

### Run Unit Tests
Verifies internal business logic, defensive gates, and synchronization math.
```bash
npm run test
```

### Run E2E Integration Tests
Simulates a full lifecycle: `Sync -> Request -> Approval -> HCM Update`.
```bash
npm run test:e2e
```

### Coverage Report
```bash
npm run test:cov
```

---

## 📖 API Documentation (Standard Endpoints)

### Balance Management
- `GET /balance/:employeeId/:locationId`: Get current local balance.
- `POST /sync/batch`: Batch sync balances from HCM.

### Request Management
- `POST /request`: Submit a new time-off request (validates locally first).
- `PATCH /request/:id/status`: Approve or Reject a request (triggers real-time HCM sync on approval).
- `GET /request/:id`: Get request details.

---

## 📄 Deliverables & TRD

- **TRD (Technical Requirement Document)**: Located in `docs/TRD.md` (or see `implementation_plan.md` in the repo root).
- **Test Proof**: Coverage reports are available in the `/coverage` directory after running `npm run test:cov`.

---

## 🏗️ Project Structure
```text
src/
├── time-off/
│   ├── dto/                # Validation schemas
│   ├── entities/           # DB Models (Balance, Request)
│   ├── enums/              # Lifecycle states
│   ├── hcm-mock.controller # Simulated external HCM system
│   ├── sync.service        # Bridge logic between DB and HCM
│   └── time-off.service    # Core business logic & Defensive gates
test/
└── time-off.e2e-spec.ts    # Full integration scenario
```
