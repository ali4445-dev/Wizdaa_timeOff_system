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
 */
@Entity('balances')
@Unique('UQ_EMPLOYEE_LOCATION', ['employeeId', 'locationId'])
export class Balance {
  @PrimaryGeneratedColumn('uuid')
  id;

  @Column({ type: 'varchar', length: 255 })
  employeeId;

  @Column({ type: 'varchar', length: 255 })
  locationId;

  @Column({ type: 'real', default: 0 })
  currentBalance;

  @Column({ type: 'datetime', nullable: true })
  lastSyncedAt;

  @VersionColumn()
  version;

  @CreateDateColumn()
  createdAt;

  @UpdateDateColumn()
  updatedAt;
}
