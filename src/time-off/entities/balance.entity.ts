import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  VersionColumn,
} from 'typeorm';

/**
 * Balance Entity
 *
 * Represents the cached time-off balance for an employee at a specific location.
 * This is a "shadow copy" of the HCM's Source of Truth — kept locally for
 * defensive validation and fast reads.
 *
 * Composite uniqueness: (employeeId, locationId)
 * The `lastSyncedAt` field tracks staleness to know when to re-verify with HCM.
 * The `version` field enables optimistic locking to prevent race conditions
 * on concurrent balance updates.
 */
@Entity('balances')
@Unique('UQ_EMPLOYEE_LOCATION', ['employeeId', 'locationId'])
export class Balance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The employee identifier (sourced from HCM).
   * Combined with locationId, forms the unique balance dimension.
   */
  @Column({ type: 'varchar', length: 255 })
  employeeId!: string;

  /**
   * The location identifier (sourced from HCM).
   * An employee can have different balances at different locations.
   */
  @Column({ type: 'varchar', length: 255 })
  locationId!: string;

  /**
   * The current cached balance (in days).
   * This value is updated on:
   *   1. Batch sync from HCM
   *   2. Realtime API calls to HCM
   *   3. Local deductions when time-off requests are approved
   *
   * Uses 'real' (float) type to support half-day leave scenarios.
   */
  @Column({ type: 'real', default: 0 })
  currentBalance!: number;

  /**
   * Timestamp of the last successful sync with the HCM system.
   * Used to determine staleness of the local balance cache.
   * null means the balance has never been synced with HCM.
   */
  @Column({ type: 'datetime', nullable: true })
  lastSyncedAt!: Date | null;

  /**
   * Optimistic locking version column.
   * Prevents race conditions when multiple requests attempt
   * to modify the same balance simultaneously.
   */
  @VersionColumn()
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
