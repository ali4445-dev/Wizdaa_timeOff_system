import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Balance } from './entities/balance.entity.js';
import { TimeOffRequest } from './entities/time-off-request.entity.js';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto.js';
import { UpsertBalanceDto } from './dto/upsert-balance.dto.js';
import { TimeOffRequestStatus } from './enums/time-off-request-status.enum.js';
import { SyncService } from './sync.service.js';

/**
 * TimeOffService
 *
 * Core business logic for managing time-off requests and balances.
 * Implements a "defensive design" pattern:
 *
 *   1. Input validation (DTO layer — class-validator)
 *   2. Business rule validation (this service layer)
 *   3. Local balance check (before any external HCM call)
 *   4. HCM verification (future — Part 3)
 *
 * This layered approach ensures the system remains functional
 * even when the HCM is unavailable or returns unreliable data.
 */
@Injectable()
export class TimeOffService {
  private readonly logger = new Logger(TimeOffService.name);

  constructor(
    @InjectRepository(Balance)
    private readonly balanceRepository: Repository<Balance>,

    @InjectRepository(TimeOffRequest)
    private readonly timeOffRequestRepository: Repository<TimeOffRequest>,

    @Inject(forwardRef(() => SyncService))
    private readonly syncService: SyncService,
  ) {}

  // ─── BALANCE OPERATIONS ──────────────────────────────────────────────

  /**
   * Retrieve the balance for a specific employee at a specific location.
   * Returns null if no balance record exists.
   */
  async getBalance(
    employeeId: string,
    locationId: string,
  ): Promise<Balance | null> {
    return this.balanceRepository.findOne({
      where: { employeeId, locationId },
    });
  }

  /**
   * Get all balances for a specific employee (across all locations).
   */
  async getBalancesByEmployee(employeeId: string): Promise<Balance[]> {
    return this.balanceRepository.find({
      where: { employeeId },
    });
  }

  /**
   * Upsert a balance record.
   * If a record for (employeeId, locationId) exists, it updates the balance.
   * If not, it creates a new record.
   *
   * Used by:
   *   - HCM batch sync endpoint
   *   - HCM realtime API responses
   *   - Admin corrections
   *
   * Sets lastSyncedAt to the current timestamp.
   */
  async upsertBalance(dto: UpsertBalanceDto): Promise<Balance> {
    const existing = await this.balanceRepository.findOne({
      where: {
        employeeId: dto.employeeId,
        locationId: dto.locationId,
      },
    });

    if (existing) {
      existing.currentBalance = dto.currentBalance;
      existing.lastSyncedAt = new Date();
      this.logger.log(
        `Balance updated for employee=${dto.employeeId} location=${dto.locationId}: ${dto.currentBalance} days`,
      );
      return this.balanceRepository.save(existing);
    }

    const balance = this.balanceRepository.create({
      employeeId: dto.employeeId,
      locationId: dto.locationId,
      currentBalance: dto.currentBalance,
      lastSyncedAt: new Date(),
    });

    this.logger.log(
      `Balance created for employee=${dto.employeeId} location=${dto.locationId}: ${dto.currentBalance} days`,
    );
    return this.balanceRepository.save(balance);
  }

  /**
   * Batch upsert balances — used when HCM sends the entire corpus.
   * Processes each balance individually to handle partial failures gracefully.
   *
   * Returns a summary of successes and failures for observability.
   */
  async batchUpsertBalances(
    balances: UpsertBalanceDto[],
  ): Promise<{ succeeded: number; failed: number; errors: string[] }> {
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const dto of balances) {
      try {
        await this.upsertBalance(dto);
        succeeded++;
      } catch (error) {
        failed++;
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        errors.push(
          `Failed for employee=${dto.employeeId} location=${dto.locationId}: ${message}`,
        );
        this.logger.error(
          `Batch upsert failed for employee=${dto.employeeId} location=${dto.locationId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    this.logger.log(
      `Batch upsert completed: ${succeeded} succeeded, ${failed} failed`,
    );
    return { succeeded, failed, errors };
  }

  // ─── TIME-OFF REQUEST OPERATIONS ─────────────────────────────────────

  /**
   * Create a new time-off request with defensive validation.
   *
   * Defensive Validation Layers:
   *   1. DTO validation (handled by ValidationPipe at controller level)
   *   2. Date logic validation (startDate <= endDate)
   *   3. Local balance sufficiency check
   *   4. Pending request overlap check (prevent double-booking)
   *
   * Note: HCM verification happens separately (Part 3).
   * The request is created as PENDING regardless of HCM state.
   */
  async createTimeOffRequest(
    dto: CreateTimeOffRequestDto,
  ): Promise<TimeOffRequest> {
    // ── Layer 2: Date validation ──
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }

    // ── Layer 3: Local balance sufficiency check ──
    const balance = await this.getBalance(dto.employeeId, dto.locationId);

    if (!balance) {
      throw new NotFoundException(
        `No balance record found for employee=${dto.employeeId} at location=${dto.locationId}. ` +
          'Balance must be synced from HCM before requesting time off.',
      );
    }

    // Calculate already-pending deductions to prevent over-commitment
    const pendingDeductions = await this.getPendingDeductions(
      dto.employeeId,
      dto.locationId,
    );

    const availableBalance = balance.currentBalance - pendingDeductions;

    if (availableBalance < dto.duration) {
      throw new ConflictException(
        `Insufficient balance. Available: ${availableBalance} days ` +
          `(current: ${balance.currentBalance}, pending: ${pendingDeductions}). ` +
          `Requested: ${dto.duration} days.`,
      );
    }

    // ── Layer 4: Overlap check ──
    const hasOverlap = await this.checkDateOverlap(
      dto.employeeId,
      dto.startDate,
      dto.endDate,
    );

    if (hasOverlap) {
      throw new ConflictException(
        'This request overlaps with an existing pending or approved time-off request.',
      );
    }

    // ── Create the request ──
    const request = this.timeOffRequestRepository.create({
      employeeId: dto.employeeId,
      locationId: dto.locationId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      duration: dto.duration,
      status: TimeOffRequestStatus.PENDING,
    });

    this.logger.log(
      `Time-off request created for employee=${dto.employeeId}: ` +
        `${dto.startDate} to ${dto.endDate} (${dto.duration} days)`,
    );

    return this.timeOffRequestRepository.save(request);
  }

  /**
   * Get a time-off request by ID.
   */
  async getTimeOffRequestById(id: string): Promise<TimeOffRequest> {
    const request = await this.timeOffRequestRepository.findOne({
      where: { id },
    });

    if (!request) {
      throw new NotFoundException(`Time-off request with id=${id} not found`);
    }

    return request;
  }

  /**
   * Get all time-off requests for an employee.
   * Optionally filter by status.
   */
  async getTimeOffRequestsByEmployee(
    employeeId: string,
    status?: TimeOffRequestStatus,
  ): Promise<TimeOffRequest[]> {
    const where: Record<string, unknown> = { employeeId };
    if (status) {
      where['status'] = status;
    }

    return this.timeOffRequestRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Approve a time-off request and deduct from local balance.
   *
   * Defensive checks:
   *   - Request must be in PENDING status
   *   - Balance must still be sufficient (may have changed since creation)
   *
   * Note: HCM notification happens separately (Part 3).
   */
  async approveRequest(id: string): Promise<TimeOffRequest> {
    const request = await this.getTimeOffRequestById(id);

    if (request.status !== TimeOffRequestStatus.PENDING) {
      throw new ConflictException(
        `Cannot approve request in '${request.status}' status. Only PENDING requests can be approved.`,
      );
    }

    // ── Phase 2: Real-time Sync (Independent Changes Logic) ──
    // Before approving, sync with HCM to get the latest Source of Truth.
    // This handles cases like work anniversary bonuses added in HCM.
    await this.syncService.syncBalanceWithHcm(
      request.employeeId,
      request.locationId,
    );

    // Re-validate balance at approval time (defensive — balance may have changed)
    const balance = await this.getBalance(
      request.employeeId,
      request.locationId,
    );

    if (!balance) {
      throw new NotFoundException(
        `Balance record not found for employee=${request.employeeId} at location=${request.locationId}`,
      );
    }

    const pendingDeductions = await this.getPendingDeductions(
      request.employeeId,
      request.locationId,
      id, // exclude current request from pending count
    );

    const availableBalance = balance.currentBalance - pendingDeductions;

    if (availableBalance < request.duration) {
      throw new ConflictException(
        `Cannot approve: insufficient balance. Available: ${availableBalance} days, ` +
          `Required: ${request.duration} days.`,
      );
    }

    // Deduct from local balance
    balance.currentBalance -= request.duration;
    await this.balanceRepository.save(balance);

    // Update request status
    request.status = TimeOffRequestStatus.APPROVED;
    const approved = await this.timeOffRequestRepository.save(request);

    // ── Phase 2: Notify HCM of Deduction ──
    const hcmNotified = await this.syncService.notifyHcmOfDeduction(
      request.employeeId,
      request.locationId,
      request.duration,
    );

    if (!hcmNotified) {
      this.logger.error(`HCM notification failed for request ${id}. Consistency check required.`);
      // Note: In a production system, we might trigger a compensating transaction
      // or mark the request as 'APPROVED_BY_LOCAL_PENDING_HCM'.
    }

    this.logger.log(
      `Time-off request ${id} approved. Balance deducted: ${request.duration} days. ` +
        `New balance: ${balance.currentBalance} days.`,
    );

    return approved;
  }

  /**
   * Reject a time-off request.
   * No balance changes occur on rejection.
   */
  async rejectRequest(id: string, reason?: string): Promise<TimeOffRequest> {
    const request = await this.getTimeOffRequestById(id);

    if (request.status !== TimeOffRequestStatus.PENDING) {
      throw new ConflictException(
        `Cannot reject request in '${request.status}' status. Only PENDING requests can be rejected.`,
      );
    }

    request.status = TimeOffRequestStatus.REJECTED;
    request.rejectionReason = reason ?? null;

    this.logger.log(
      `Time-off request ${id} rejected. Reason: ${reason ?? 'No reason provided'}`,
    );

    return this.timeOffRequestRepository.save(request);
  }

  /**
   * Cancel a time-off request.
   * If the request was APPROVED, restores the balance.
   */
  async cancelRequest(id: string): Promise<TimeOffRequest> {
    const request = await this.getTimeOffRequestById(id);

    if (
      request.status !== TimeOffRequestStatus.PENDING &&
      request.status !== TimeOffRequestStatus.APPROVED
    ) {
      throw new ConflictException(
        `Cannot cancel request in '${request.status}' status. ` +
          'Only PENDING or APPROVED requests can be cancelled.',
      );
    }

    // If approved, restore the balance
    if (request.status === TimeOffRequestStatus.APPROVED) {
      const balance = await this.getBalance(
        request.employeeId,
        request.locationId,
      );

      if (balance) {
        balance.currentBalance += request.duration;
        await this.balanceRepository.save(balance);
        this.logger.log(
          `Balance restored: +${request.duration} days for employee=${request.employeeId}`,
        );
      }
    }

    request.status = TimeOffRequestStatus.CANCELLED;

    this.logger.log(`Time-off request ${id} cancelled.`);

    return this.timeOffRequestRepository.save(request);
  }

  // ─── PRIVATE HELPERS ─────────────────────────────────────────────────

  /**
   * Calculate total pending deductions for an employee at a location.
   * This accounts for time-off requests that are PENDING (not yet approved)
   * to prevent over-commitment of the balance.
   *
   * @param excludeRequestId - Optionally exclude a specific request (used during approval)
   */
  private async getPendingDeductions(
    employeeId: string,
    locationId: string,
    excludeRequestId?: string,
  ): Promise<number> {
    const query = this.timeOffRequestRepository
      .createQueryBuilder('request')
      .select('COALESCE(SUM(request.duration), 0)', 'total')
      .where('request.employeeId = :employeeId', { employeeId })
      .andWhere('request.locationId = :locationId', { locationId })
      .andWhere('request.status = :status', {
        status: TimeOffRequestStatus.PENDING,
      });

    if (excludeRequestId) {
      query.andWhere('request.id != :excludeRequestId', { excludeRequestId });
    }

    const result = await query.getRawOne<{ total: number }>();
    return result?.total ?? 0;
  }

  /**
   * Check if a new request's dates overlap with existing PENDING or APPROVED requests.
   * Prevents employees from double-booking time off.
   */
  private async checkDateOverlap(
    employeeId: string,
    startDate: string,
    endDate: string,
  ): Promise<boolean> {
    const overlapping = await this.timeOffRequestRepository
      .createQueryBuilder('request')
      .where('request.employeeId = :employeeId', { employeeId })
      .andWhere('request.status IN (:...statuses)', {
        statuses: [
          TimeOffRequestStatus.PENDING,
          TimeOffRequestStatus.APPROVED,
        ],
      })
      .andWhere('request.startDate <= :endDate', { endDate })
      .andWhere('request.endDate >= :startDate', { startDate })
      .getCount();

    return overlapping > 0;
  }
}
