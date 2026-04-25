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
} from '@nestjs/common';
import { TimeOffService } from './time-off.service.js';
import { SyncService } from './sync.service.js';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto.js';
import { UpsertBalanceDto } from './dto/upsert-balance.dto.js';
import { TimeOffRequestStatus } from './enums/time-off-request-status.enum.js';

/**
 * TimeOffController
 *
 * REST API endpoints for the Time-Off Microservice.
 * All endpoints are prefixed with /time-off.
 *
 * Endpoints:
 *   Balance Management:
 *     GET    /time-off/balance/:employeeId/:locationId  — Get specific balance
 *     GET    /time-off/balance/:employeeId              — Get all balances for employee
 *     POST   /time-off/balance                          — Upsert a single balance
 *     POST   /time-off/balance/batch                    — Batch upsert balances (HCM sync)
 *
 *   Time-Off Request Management:
 *     POST   /time-off/requests                         — Create a new request
 *     GET    /time-off/requests/:id                     — Get a specific request
 *     GET    /time-off/requests/employee/:employeeId    — Get all requests for employee
 *     PATCH  /time-off/requests/:id/approve             — Approve a request
 *     PATCH  /time-off/requests/:id/reject              — Reject a request
 *     PATCH  /time-off/requests/:id/cancel              — Cancel a request
 */
@Controller()
export class TimeOffController {
  constructor(
    private readonly timeOffService: TimeOffService,
    private readonly syncService: SyncService,
  ) {}

  // ─── BALANCE ENDPOINTS ───────────────────────────────────────────────

  /**
   * GET /balance/:employeeId/:locationId
   * Returns the current balance from the local database.
   */
  @Get('balance/:employeeId/:locationId')
  async getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ) {
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
  async getBalancesByEmployee(@Param('employeeId') employeeId: string) {
    const balances =
      await this.timeOffService.getBalancesByEmployee(employeeId);

    return { data: balances };
  }

  // ─── TIME-OFF REQUEST ENDPOINTS ──────────────────────────────────────

  /**
   * POST /request
   * Allows an employee to submit a time-off request.
   * Validates local balance before any external sync.
   */
  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  async submitRequest(@Body() dto: CreateTimeOffRequestDto) {
    const request = await this.timeOffService.createTimeOffRequest(dto);
    return { data: request };
  }

  /**
   * PATCH /request/:id/status
   * Allows a manager to approve or reject a request.
   * Upon approval, triggers a real-time update to the HCM API.
   */
  @Patch('request/:id/status')
  async updateRequestStatus(
    @Param('id') id: string,
    @Body('status') status: TimeOffRequestStatus,
    @Body('reason') reason?: string,
  ) {
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
  async getRequest(@Param('id') id: string) {
    const request = await this.timeOffService.getTimeOffRequestById(id);
    return { data: request };
  }

  @Get('requests/employee/:employeeId')
  async getRequestsByEmployee(
    @Param('employeeId') employeeId: string,
    @Query('status') status?: TimeOffRequestStatus,
  ) {
    const requests = await this.timeOffService.getTimeOffRequestsByEmployee(
      employeeId,
      status,
    );
    return { data: requests };
  }

  @Patch('request/:id/cancel')
  async cancelRequest(@Param('id') id: string) {
    const request = await this.timeOffService.cancelRequest(id);
    return { data: request };
  }

  // ─── SYNC & ADMIN ENDPOINTS ──────────────────────────────────────────

  @Post('sync/realtime')
  @HttpCode(HttpStatus.OK)
  async realtimeSync(
    @Body('employeeId') employeeId: string,
    @Body('locationId') locationId: string,
  ) {
    const balance = await this.syncService.syncBalanceWithHcm(
      employeeId,
      locationId,
    );
    return { data: { balance } };
  }

  @Post('sync/batch')
  @HttpCode(HttpStatus.OK)
  async batchSync(@Body() balances: UpsertBalanceDto[]) {
    const result = await this.syncService.processBatchSync(balances);
    return { data: result };
  }
}
