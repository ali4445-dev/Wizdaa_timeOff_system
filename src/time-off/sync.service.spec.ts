import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { SyncService } from './sync.service.js';
import { TimeOffService } from './time-off.service.js';
import { InternalServerErrorException } from '@nestjs/common';

describe('SyncService (HCM Integration & Independent Changes)', () => {
  let service: SyncService;
  let httpService: HttpService;
  let timeOffService: TimeOffService;

  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
  };

  const mockTimeOffService = {
    upsertBalance: jest.fn(),
    batchUpsertBalances: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: TimeOffService, useValue: mockTimeOffService },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    httpService = module.get<HttpService>(HttpService);
    timeOffService = module.get<TimeOffService>(TimeOffService);

    jest.clearAllMocks();
  });

  // ─── 1. MOCK HCM UPDATES & ERRORS ────────────────────────────────────

  describe('syncBalanceWithHcm', () => {
    it('should update local balance matching HCM Source of Truth (Anniversary Case)', async () => {
      // Mock HCM returning 25 days (maybe it was 20 locally before)
      mockHttpService.get.mockReturnValue(of({
        data: { balance: 25 }
      }));

      await service.syncBalanceWithHcm('emp1', 'locA');

      // VERIFY: local balance updated to 25
      expect(timeOffService.upsertBalance).toHaveBeenCalledWith({
        employeeId: 'emp1',
        locationId: 'locA',
        currentBalance: 25,
      });
    });

    it('should throw InternalServerErrorException when HCM API fails', async () => {
      mockHttpService.get.mockReturnValue(throwError(() => new Error('HCM Timeout')));

      await expect(service.syncBalanceWithHcm('emp1', 'locA')).rejects.toThrow(
        InternalServerErrorException
      );
    });
  });

  describe('notifyHcmOfDeduction', () => {
    it('should return true on successful HCM update', async () => {
      mockHttpService.post.mockReturnValue(of({
        data: { success: true, transactionId: 'tx123' }
      }));

      const result = await service.notifyHcmOfDeduction('emp1', 'locA', 2);
      expect(result).toBe(true);
    });

    it('should return false when HCM returns Insufficient Balance (HCM Error Case)', async () => {
      mockHttpService.post.mockReturnValue(of({
        data: { success: false, error: 'Insufficient balance on HCM side' }
      }));

      const result = await service.notifyHcmOfDeduction('emp1', 'locA', 100);
      expect(result).toBe(false);
    });
  });

  // ─── 4. BATCH UPDATE REGRESSION ──────────────────────────────────────

  describe('processBatchSync', () => {
    it('should process entire corpus and return summary', async () => {
      const batchData = [
        { employeeId: 'e1', locationId: 'l1', currentBalance: 10 },
        { employeeId: 'e2', locationId: 'l1', currentBalance: 15 },
      ];

      mockTimeOffService.batchUpsertBalances.mockResolvedValue({
        succeeded: 2,
        failed: 0,
        errors: [],
      });

      const result = await service.processBatchSync(batchData);
      
      expect(result.succeeded).toBe(2);
      expect(timeOffService.batchUpsertBalances).toHaveBeenCalledWith(batchData);
    });
  });
});
