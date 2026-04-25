import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Dependencies,
  Bind,
} from '@nestjs/common';
import { TimeOffService } from './time-off.service.js';
import { SyncService } from './sync.service.js';
import { TimeOffRequestStatus } from './enums/time-off-request-status.enum.js';

/**
 * TimeOffController
 */
@Controller()
@Dependencies(TimeOffService, SyncService)
export class TimeOffController {
  constructor(timeOffService, syncService) {
    this.timeOffService = timeOffService;
    this.syncService = syncService;
  }

  // ─── BALANCE ENDPOINTS ───────────────────────────────────────────────

  @Get('balance/:employeeId/:locationId')
  @Bind(Param('employeeId'), Param('locationId'))
  async getBalance(employeeId, locationId) {
    const balance = await this.timeOffService.getBalance(
      employeeId,
      locationId,
    );

    return {
      data: balance,
      synced: balance?.lastSyncedAt != null,
    };
  }

  @Get('balances/:employeeId')
  @Bind(Param('employeeId'))
  async getBalancesByEmployee(employeeId) {
    const balances =
      await this.timeOffService.getBalancesByEmployee(employeeId);

    return { data: balances };
  }

  // ─── TIME-OFF REQUEST ENDPOINTS ──────────────────────────────────────

  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  @Bind(Body())
  async submitRequest(dto) {
    const request = await this.timeOffService.createTimeOffRequest(dto);
    return { data: request };
  }

  @Patch('request/:id/status')
  @Bind(Param('id'), Body('status'), Body('reason'))
  async updateRequestStatus(id, status, reason) {
    if (status === TimeOffRequestStatus.APPROVED) {
      const request = await this.timeOffService.approveRequest(id);
      return { data: request };
    } else if (status === TimeOffRequestStatus.REJECTED) {
      const request = await this.timeOffService.rejectRequest(id, reason);
      return { data: request };
    } else {
      throw new BadRequestException('Use this endpoint only for APPROVED or REJECTED status updates.');
    }
  }

  @Get('request/:id')
  @Bind(Param('id'))
  async getRequest(id) {
    const request = await this.timeOffService.getTimeOffRequestById(id);
    return { data: request };
  }

  @Get('requests/employee/:employeeId')
  @Bind(Param('employeeId'), Query('status'))
  async getRequestsByEmployee(employeeId, status) {
    const requests = await this.timeOffService.getTimeOffRequestsByEmployee(
      employeeId,
      status,
    );
    return { data: requests };
  }

  @Patch('request/:id/cancel')
  @Bind(Param('id'))
  async cancelRequest(id) {
    const request = await this.timeOffService.cancelRequest(id);
    return { data: request };
  }

  // ─── SYNC & ADMIN ENDPOINTS ──────────────────────────────────────────

  @Post('sync/realtime')
  @HttpCode(HttpStatus.OK)
  @Bind(Body('employeeId'), Body('locationId'))
  async realtimeSync(employeeId, locationId) {
    const balance = await this.syncService.syncBalanceWithHcm(
      employeeId,
      locationId,
    );
    return { data: { balance } };
  }

  @Post('sync/batch')
  @HttpCode(HttpStatus.OK)
  @Bind(Body())
  async batchSync(balances) {
    const result = await this.syncService.processBatchSync(balances);
    return { data: result };
  }
}
