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
