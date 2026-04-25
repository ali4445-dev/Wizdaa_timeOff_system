import { Injectable, Logger, InternalServerErrorException, Inject, forwardRef, Dependencies } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { TimeOffService } from './time-off.service.js';

/**
 * SyncService
 */
@Injectable()
@Dependencies(HttpService, forwardRef(() => TimeOffService))
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly hcmBaseUrl = 'http://localhost:3000/mock-hcm';

  constructor(
    httpService,
    @Inject(forwardRef(() => TimeOffService))
    timeOffService,
  ) {
    this.httpService = httpService;
    this.timeOffService = timeOffService;
  }

  async syncBalanceWithHcm(employeeId, locationId) {
    try {
      this.logger.log(`Syncing balance for employee=${employeeId} location=${locationId} with HCM...`);
      
      const response = await firstValueFrom(
        this.httpService.get(`${this.hcmBaseUrl}/balance/${employeeId}/${locationId}`)
      );

      const hcmBalance = response.data.balance;
      
      await this.timeOffService.upsertBalance({
        employeeId,
        locationId,
        currentBalance: hcmBalance,
      });

      this.logger.log(`Sync complete. HCM Balance (Source of Truth): ${hcmBalance}`);
      return hcmBalance;
    } catch (error) {
      this.logger.error(`HCM Sync failed for employee=${employeeId}: ${error.message}`);
      throw new InternalServerErrorException('Failed to sync with HCM system');
    }
  }

  async notifyHcmOfDeduction(employeeId, locationId, amount) {
    try {
      this.logger.log(`Notifying HCM of deduction: ${amount} days for ${employeeId}`);
      
      const response = await firstValueFrom(
        this.httpService.post(`${this.hcmBaseUrl}/deduct`, {
          employeeId,
          locationId,
          amount,
        })
      );

      if (response.data.success) {
        this.logger.log(`HCM deduction successful. Transaction: ${response.data.transactionId}`);
        return true;
      } else {
        this.logger.warn(`HCM deduction declined: ${response.data.error}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`HCM deduction notification failed: ${error.message}`);
      return false;
    }
  }

  async processBatchSync(balances) {
    this.logger.log(`Starting batch sync for ${balances.length} records...`);
    const summary = await this.timeOffService.batchUpsertBalances(balances);
    this.logger.log(`Batch sync finished. Succeeded: ${summary.succeeded}, Failed: ${summary.failed}`);
    return summary;
  }
}
