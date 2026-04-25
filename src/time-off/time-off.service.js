import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
  Inject,
  forwardRef,
  Dependencies,
} from '@nestjs/common';
import { InjectRepository, getRepositoryToken } from '@nestjs/typeorm';
import { Balance } from './entities/balance.entity.js';
import { TimeOffRequest } from './entities/time-off-request.entity.js';
import { TimeOffRequestStatus } from './enums/time-off-request-status.enum.js';
import { SyncService } from './sync.service.js';

/**
 * TimeOffService
 */
@Injectable()
@Dependencies(
  getRepositoryToken(Balance),
  getRepositoryToken(TimeOffRequest),
  forwardRef(() => SyncService),
)
export class TimeOffService {
  private readonly logger = new Logger(TimeOffService.name);

  constructor(
    @InjectRepository(Balance)
    balanceRepository,

    @InjectRepository(TimeOffRequest)
    timeOffRequestRepository,

    @Inject(forwardRef(() => SyncService))
    syncService,
  ) {
    this.balanceRepository = balanceRepository;
    this.timeOffRequestRepository = timeOffRequestRepository;
    this.syncService = syncService;
  }

  // ─── BALANCE OPERATIONS ──────────────────────────────────────────────

  async getBalance(employeeId, locationId) {
    return this.balanceRepository.findOne({
      where: { employeeId, locationId },
    });
  }

  async getBalancesByEmployee(employeeId) {
    return this.balanceRepository.find({
      where: { employeeId },
    });
  }

  async upsertBalance(dto) {
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

  async batchUpsertBalances(balances) {
    let succeeded = 0;
    let failed = 0;
    const errors = [];

    for (const dto of balances) {
      try {
        await this.upsertBalance(dto);
        succeeded++;
      } catch (error) {
        failed++;
        const message = error?.message || 'Unknown error';
        errors.push(
          `Failed for employee=${dto.employeeId} location=${dto.locationId}: ${message}`,
        );
        this.logger.error(
          `Batch upsert failed for employee=${dto.employeeId} location=${dto.locationId}`,
          error?.stack,
        );
      }
    }

    this.logger.log(
      `Batch upsert completed: ${succeeded} succeeded, ${failed} failed`,
    );
    return { succeeded, failed, errors };
  }

  // ─── TIME-OFF REQUEST OPERATIONS ─────────────────────────────────────

  async createTimeOffRequest(dto) {
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }

    const balance = await this.getBalance(dto.employeeId, dto.locationId);

    if (!balance) {
      throw new NotFoundException(
        `No balance record found for employee=${dto.employeeId} at location=${dto.locationId}. ` +
          'Balance must be synced from HCM before requesting time off.',
      );
    }

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

  async getTimeOffRequestById(id) {
    const request = await this.timeOffRequestRepository.findOne({
      where: { id },
    });

    if (!request) {
      throw new NotFoundException(`Time-off request with id=${id} not found`);
    }

    return request;
  }

  async getTimeOffRequestsByEmployee(employeeId, status) {
    const where = { employeeId };
    if (status) {
      where.status = status;
    }

    return this.timeOffRequestRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async approveRequest(id) {
    const request = await this.getTimeOffRequestById(id);

    if (request.status !== TimeOffRequestStatus.PENDING) {
      throw new ConflictException(
        `Cannot approve request in '${request.status}' status. Only PENDING requests can be approved.`,
      );
    }

    await this.syncService.syncBalanceWithHcm(
      request.employeeId,
      request.locationId,
    );

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
      id,
    );

    const availableBalance = balance.currentBalance - pendingDeductions;

    if (availableBalance < request.duration) {
      throw new ConflictException(
        `Cannot approve: insufficient balance. Available: ${availableBalance} days, ` +
          `Required: ${request.duration} days.`,
      );
    }

    balance.currentBalance -= request.duration;
    await this.balanceRepository.save(balance);

    request.status = TimeOffRequestStatus.APPROVED;
    const approved = await this.timeOffRequestRepository.save(request);

    const hcmNotified = await this.syncService.notifyHcmOfDeduction(
      request.employeeId,
      request.locationId,
      request.duration,
    );

    if (!hcmNotified) {
      this.logger.error(`HCM notification failed for request ${id}. Consistency check required.`);
    }

    this.logger.log(
      `Time-off request ${id} approved. Balance deducted: ${request.duration} days. ` +
        `New balance: ${balance.currentBalance} days.`,
    );

    return approved;
  }

  async rejectRequest(id, reason) {
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

  async cancelRequest(id) {
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

  async getPendingDeductions(employeeId, locationId, excludeRequestId) {
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

    const result = await query.getRawOne();
    return result?.total ?? 0;
  }

  async checkDateOverlap(employeeId, startDate, endDate) {
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
