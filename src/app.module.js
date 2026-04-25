import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TimeOffModule } from './time-off/time-off.module.js';
import { Balance } from './time-off/entities/balance.entity.js';
import { TimeOffRequest } from './time-off/entities/time-off-request.entity.js';

/**
 * Root Application Module
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'data/timeoff.sqlite',
      entities: [Balance, TimeOffRequest],
      synchronize: true,
      logging: process.env.NODE_ENV !== 'production',
    }),
    TimeOffModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
