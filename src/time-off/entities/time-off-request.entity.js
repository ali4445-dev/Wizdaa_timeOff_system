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
 */
@Entity('time_off_requests')
export class TimeOffRequest {
  @PrimaryGeneratedColumn('uuid')
  id;

  @Column({ type: 'varchar', length: 255 })
  employeeId;

  @Column({ type: 'varchar', length: 255 })
  locationId;

  @Column({ type: 'date' })
  startDate;

  @Column({ type: 'date' })
  endDate;

  @Column({ type: 'real' })
  duration;

  @Column({
    type: 'varchar',
    length: 20,
    default: TimeOffRequestStatus.PENDING,
  })
  status;

  @Column({ type: 'text', nullable: true })
  rejectionReason;

  @CreateDateColumn()
  createdAt;

  @UpdateDateColumn()
  updatedAt;
}
