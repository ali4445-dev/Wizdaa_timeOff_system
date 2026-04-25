import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Balance } from './entities/balance.entity.js';
import { TimeOffRequest } from './entities/time-off-request.entity.js';
import { TimeOffService } from './time-off.service.js';
import { SyncService } from './sync.service.js';
import { TimeOffController } from './time-off.controller.js';
import { MockHcmController } from './hcm-mock.controller.js';
import { HttpModule } from '@nestjs/axios';

/**
 * TimeOffModule
 *
 * Encapsulates all time-off related functionality:
 *   - Balance management (CRUD + batch sync)
 *   - Time-off request lifecycle (create, approve, reject, cancel)
 *   - Defensive validation logic
 *
 * Architecture:
 *   Controller → Service → Repository (TypeORM) → SQLite
 *
 * Future extensions (Parts 2-4):
 *   - HcmClientService (external HCM API integration)
 *   - SyncService (batch reconciliation)
 *   - EventEmitter integration for async notifications
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Balance, TimeOffRequest]),
    HttpModule,
  ],
  controllers: [TimeOffController, MockHcmController],
  providers: [TimeOffService, SyncService],
  exports: [TimeOffService, SyncService],
})
export class TimeOffModule {}
