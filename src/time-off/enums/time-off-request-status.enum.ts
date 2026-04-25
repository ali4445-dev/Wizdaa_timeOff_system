/**
 * Enum representing the lifecycle states of a Time-Off Request.
 *
 * State Transitions:
 *   PENDING  → APPROVED  (Manager approves + HCM confirms balance)
 *   PENDING  → REJECTED  (Insufficient balance / Manager rejects / HCM denies)
 *   PENDING  → CANCELLED (Employee cancels before decision)
 *   APPROVED → CANCELLED (Employee cancels approved leave — balance restored)
 */
export enum TimeOffRequestStatus {
  /** Request submitted, awaiting manager approval */
  PENDING = 'PENDING',

  /** Manager approved and balance was deducted */
  APPROVED = 'APPROVED',

  /** Request was rejected (insufficient balance, manager denial, or HCM error) */
  REJECTED = 'REJECTED',

  /** Request was cancelled by the employee */
  CANCELLED = 'CANCELLED',
}
