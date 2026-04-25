import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TimeOffRequestStatus } from '../enums/time-off-request-status.enum.js';

/**
 * TimeOffRequest Entity
 *
 * Represents a single time-off request submitted by an employee.
 * Each request is scoped to a specific (employeeId, locationId) balance dimension.
 *
 * Lifecycle:
 *   1. Employee submits request → status = PENDING
 *   2. Local defensive validation checks balance sufficiency
 *   3. Manager reviews and approves/rejects
 *   4. On approval, HCM is notified and balance is deducted
 *   5. On rejection, no balance change occurs
 *
 * The `duration` field is pre-calculated (endDate - startDate in business days)
 * and stored to avoid recalculation and to serve as the authoritative deduction amount.
 */
@Entity('time_off_requests')
export class TimeOffRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The employee making the time-off request.
   * Must correspond to an existing Balance record.
   */
  @Column({ type: 'varchar', length: 255 })
  employeeId!: string;

  /**
   * The location whose balance will be deducted.
   * Combined with employeeId, identifies the specific balance to affect.
   */
  @Column({ type: 'varchar', length: 255 })
  locationId!: string;

  /**
   * The first day of leave (inclusive).
   * Stored as a date string (YYYY-MM-DD) for SQLite compatibility.
   */
  @Column({ type: 'date' })
  startDate!: string;

  /**
   * The last day of leave (inclusive).
   * Must be >= startDate.
   */
  @Column({ type: 'date' })
  endDate!: string;

  /**
   * The number of leave days requested.
   * Pre-calculated and immutable after creation.
   * Supports fractional values (e.g., 0.5 for half-day).
   */
  @Column({ type: 'real' })
  duration!: number;

  /**
   * Current status in the request lifecycle.
   * Drives which operations are valid on this request.
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: TimeOffRequestStatus.PENDING,
  })
  status!: TimeOffRequestStatus;

  /**
   * Optional reason for rejection (populated when status → REJECTED).
   * Helps employees understand why their request was denied.
   */
  @Column({ type: 'text', nullable: true })
  rejectionReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
