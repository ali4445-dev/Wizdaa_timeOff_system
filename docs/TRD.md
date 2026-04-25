# Technical Requirement Document (TRD): Time-Off Microservice

## 1. Goal Description
The objective is to build a robust Time-Off Microservice that manages employee leave balances and requests while synchronizing with an external Human Capital Management (HCM) system, which remains the "Source of Truth". The primary challenge is maintaining data integrity across two independent systems and handling bidirectional updates safely.

---

## 2. Key Challenges & Solutions

### 2.1 The "Source of Truth" Dilemma
**Challenge**: HCM can update balances independently (e.g., anniversary bonuses).
**Solution**: Implement a **"Trust but Verify"** pattern. HCM data is always prioritized. Any discrepancy found during a sync cycle (real-time or batch) causes the local database to overwrite its state with the HCM state.

### 2.2 Latency & Reliability
**Challenge**: Real-time calls to HCM can be slow or fail.
**Solution**: Use **Defensive Validation Layers**. Perform the first line of balance checks locally using cached data (shadow copy) before attempting any external network calls.

### 2.3 Race Conditions
**Challenge**: Multiple requests or concurrent syncs could lead to over-deduction.
**Solution**: Implement **Optimistic Locking** using a versioning column on the `Balance` entity. Additionally, calculate `Available Balance` by subtracting `Pending` local requests from the current cached balance.

---

## 3. Architecture Overview

### 3.1 Data Model
| Entity | Strategy | Key Fields |
|--------|----------|------------|
| **Balance** | Shadow Copy | `employeeId`, `locationId`, `currentBalance`, `lastSyncedAt`, `version` |
| **TimeOffRequest** | State Machine | `id`, `duration`, `status` (PENDING, APPROVED, REJECTED, CANCELLED) |

### 3.2 Defensive Validation Layers
1.  **Input Layer**: Class-validator DTOs (type safety, format).
2.  **Business Layer**: Date logic (start <= end) and overlap detection.
3.  **Local Persistence Layer**: Checks `currentBalance - Σ(PendingRequests) >= Duration`.
4.  **External Layer**: Real-time verification with HCM during the approval phase.

---

## 4. Integration Patterns

### 4.1 Real-time Synchronization
Triggered during the `approve` lifecycle:
1.  Fetch latest HCM balance.
2.  Update local "Source of Truth" cache.
3.  Perform final local validation.
4.  Deduct balance and Notify HCM.

### 4.2 Batch Synchronization
A bulk ingestion endpoint `POST /sync/batch` handles large corpus updates from HCM, ensuring the local shadow copy eventually converges with the master data.

---

## 5. Alternatives Considered

| Alternative | Pros | Cons | Recommendation |
|-------------|------|------|----------------|
| **No Local Balance** | Absolute truth always | High latency; System breaks if HCM is down. | Rejected |
| **Eventual Consistency only** | High performance | Risk of over-booking before sync happens. | Rejected |
| **Shadow Copy w/ Local Validation** | High availability; Defensive | Complexity in sync logic. | **Selected** |

---

## 6. Testing Strategy

### 6.1 Unit Testing
- Mocking repositories and external consumers.
- Focused on edge cases: 0.5 day requests, date overlaps, and precision handling.

### 6.2 Integration (E2E) Testing
- Full lifecycle tests: `Sync -> Request -> Approve -> Verify`.
- Mocking the network layer (`HttpService`) to simulate HCM latency and errors (Insufficient Balance).

### 6.3 Boundary Testing
- Specifically testing "Independent Changes" where the HCM balance increases (Anniversary use-case) to ensure the system reconciles correctly without losing local state.

---

## 7. Verification Plan
- **Test Suite**: `npm run test` and `npm run test:e2e`.
- **Coverage**: Aiming for >90% on business logic services.
- **Mock Server**: Includes a `MockHcmController` for manual postman testing.
