import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TimeOffService } from './time-off.service.js';
import { SyncService } from './sync.service.js';
import { Balance } from './entities/balance.entity.js';
import { TimeOffRequest } from './entities/time-off-request.entity.js';
import { TimeOffRequestStatus } from './enums/time-off-request-status.enum.js';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';

describe('TimeOffService (Defensive & Core Logic)', () => {
  let service: TimeOffService;
  let balanceRepo: Repository<Balance>;
  let requestRepo: Repository<TimeOffRequest>;
  let syncService: SyncService;

  const mockBalanceRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockRequestRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockSyncService = {
    syncBalanceWithHcm: jest.fn(),
    notifyHcmOfDeduction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeOffService,
        {
          provide: getRepositoryToken(Balance),
          useValue: mockBalanceRepo,
        },
        {
          provide: getRepositoryToken(TimeOffRequest),
          useValue: mockRequestRepo,
        },
        {
          provide: SyncService,
          useValue: mockSyncService,
        },
      ],
    }).compile();

    service = module.get<TimeOffService>(TimeOffService);
    balanceRepo = module.get<Repository<Balance>>(getRepositoryToken(Balance));
    requestRepo = module.get<Repository<TimeOffRequest>>(
      getRepositoryToken(TimeOffRequest),
    );
    syncService = module.get<SyncService>(SyncService);

    jest.clearAllMocks();
  });

  // ─── 3. DEFENSIVE TESTS ──────────────────────────────────────────────

  describe('createTimeOffRequest (Defensive Validation)', () => {
    it('should reject requests with invalid date range', async () => {
      const dto = {
        employeeId: 'emp1',
        locationId: 'locA',
        startDate: '2024-05-10',
        endDate: '2024-05-01', // Before start
        duration: 5,
      };

      await expect(service.createTimeOffRequest(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject if no local balance record exists', async () => {
      mockBalanceRepo.findOne.mockResolvedValue(null);

      const dto = {
        employeeId: 'emp1',
        locationId: 'locA',
        startDate: '2024-05-01',
        endDate: '2024-05-05',
        duration: 4,
      };

      await expect(service.createTimeOffRequest(dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject if local balance is insufficient (Defensive Layer 3)', async () => {
      // Local balance is 5
      mockBalanceRepo.findOne.mockResolvedValue({ currentBalance: 5 });
      
      // No pending deductions
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: 0 }),
      };
      mockRequestRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const dto = {
        employeeId: 'emp1',
        locationId: 'locA',
        startDate: '2024-05-01',
        endDate: '2024-05-10',
        duration: 7, // 7 > 5
      };

      await expect(service.createTimeOffRequest(dto)).rejects.toThrow(
        ConflictException,
      );
      
      // VERIFY: No SyncService call made because local check failed (Defensive!)
      expect(syncService.syncBalanceWithHcm).not.toHaveBeenCalled();
    });

    it('should factor in PENDING requests when checking balance', async () => {
      // Local current balance is 10
      mockBalanceRepo.findOne.mockResolvedValue({ currentBalance: 10 });
      
      // 8 days are already PENDING
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: 8 }),
      };
      mockRequestRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const dto = {
        employeeId: 'emp1',
        locationId: 'locA',
        startDate: '2024-05-15',
        endDate: '2024-05-18',
        duration: 3, // 10 - 8 = 2 available. 3 > 2 -> Should fail.
      };

      await expect(service.createTimeOffRequest(dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── 4. REGRESSION GUARDING ──────────────────────────────────────────

  describe('batchUpsertBalances (Regression Guarding)', () => {
    it('should update local values but not directly affect pending status records', async () => {
      const dto = {
        employeeId: 'emp1',
        locationId: 'locA',
        currentBalance: 50,
      };

      mockBalanceRepo.findOne.mockResolvedValue({ 
        employeeId: 'emp1', 
        locationId: 'locA', 
        currentBalance: 10 
      });

      await service.upsertBalance(dto);

      expect(mockBalanceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ currentBalance: 50 })
      );
      // Ensure records are being updated to match Source of Truth
    });
  });

  // ─── 2. BOUNDARY TESTS (REALTIME SYNC / ANNIVERSARY) ──────────────────

  describe('approveRequest (Real-time Sync & anniversary)', () => {
    it('should trigger HCM sync before approval to handle independent changes', async () => {
      const mockRequest = {
        id: 'req-1',
        employeeId: 'emp1',
        locationId: 'locA',
        duration: 5,
        status: TimeOffRequestStatus.PENDING,
      };

      mockRequestRepo.findOne.mockResolvedValue(mockRequest);
      
      // Local says 10, but HCM might have added a bonus.
      // syncService.syncBalanceWithHcm will update local repo before we proceed.
      mockBalanceRepo.findOne.mockResolvedValue({ currentBalance: 15 });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: 0 }),
      };
      mockRequestRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.approveRequest('req-1');

      // VERIFY: Real-time sync was triggered
      expect(syncService.syncBalanceWithHcm).toHaveBeenCalledWith('emp1', 'locA');
      
      // VERIFY: Balance deducted correctly (15 - 5 = 10)
      expect(mockBalanceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ currentBalance: 10 })
      );

      // VERIFY: HCM notified of final deduction
      expect(syncService.notifyHcmOfDeduction).toHaveBeenCalledWith('emp1', 'locA', 5);
    });
  });
});
