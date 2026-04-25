import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
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
  let service;
  let balanceRepo;
  let requestRepo;
  let syncService;

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
    const module = await Test.createTestingModule({
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

    service = module.get(TimeOffService);
    balanceRepo = module.get(getRepositoryToken(Balance));
    requestRepo = module.get(getRepositoryToken(TimeOffRequest));
    syncService = module.get(SyncService);

    jest.clearAllMocks();
  });

  describe('createTimeOffRequest (Defensive Validation)', () => {
    it('should reject requests with invalid date range', async () => {
      const dto = {
        employeeId: 'emp1',
        locationId: 'locA',
        startDate: '2024-05-10',
        endDate: '2024-05-01',
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
      mockBalanceRepo.findOne.mockResolvedValue({ currentBalance: 5 });
      
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
        duration: 7,
      };

      await expect(service.createTimeOffRequest(dto)).rejects.toThrow(
        ConflictException,
      );
      
      expect(syncService.syncBalanceWithHcm).not.toHaveBeenCalled();
    });

    it('should factor in PENDING requests when checking balance', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ currentBalance: 10 });
      
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
        duration: 3,
      };

      await expect(service.createTimeOffRequest(dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

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
    });
  });

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
      mockBalanceRepo.findOne.mockResolvedValue({ currentBalance: 15 });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: 0 }),
      };
      mockRequestRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.approveRequest('req-1');

      expect(syncService.syncBalanceWithHcm).toHaveBeenCalledWith('emp1', 'locA');
      
      expect(mockBalanceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ currentBalance: 10 })
      );

      expect(syncService.notifyHcmOfDeduction).toHaveBeenCalledWith('emp1', 'locA', 5);
    });
  });
});
