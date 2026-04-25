import { Injectable, Logger, InternalServerErrorException, Inject, forwardRef } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { TimeOffService } from './time-off.service.js';
import { UpsertBalanceDto } from './dto/upsert-balance.dto.js';

/**
 * SyncService
 *
 * Handles communication between the local system and the HCM Source of Truth.
 * Implements Real-time sync, Batch sync, and Independent Change logic.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly hcmBaseUrl = 'http://localhost:3000/mock-hcm'; // Self-referencing mock for this exercise

  constructor(
    private readonly httpService: HttpService,
    
    @Inject(forwardRef(() => TimeOffService))
    private readonly timeOffService: TimeOffService,
  ) {}


  /**
   * Real-time Sync: Fetches latest balance from HCM and updates local DB.
   * Logic for 'Independent Changes': If HCM (Source of Truth) differs,
   * local balance is updated to match.
   */
  async syncBalanceWithHcm(employeeId: string, locationId: string): Promise<number> {
    try {
      this.logger.log(`Syncing balance for employee=${employeeId} location=${locationId} with HCM...`);
      
      const response = await firstValueFrom(
        this.httpService.get(`${this.hcmBaseUrl}/balance/${employeeId}/${locationId}`)
      );

      const hcmBalance = response.data.balance;
      
      // Update local record to match HCM (Source of Truth)
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

  /**
   * Notifies HCM of a deduction. Used when a request is approved locally.
   */
  async notifyHcmOfDeduction(employeeId: string, locationId: string, amount: number): Promise<boolean> {
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

  /**
   * Batch Sync: Processes a large corpus of balance data from HCM.
   * Overwrites local records with HCM data.
   */
  async processBatchSync(balances: UpsertBalanceDto[]): Promise<any> {
    this.logger.log(`Starting batch sync for ${balances.length} records...`);
    const summary = await this.timeOffService.batchUpsertBalances(balances);
    this.logger.log(`Batch sync finished. Succeeded: ${summary.succeeded}, Failed: ${summary.failed}`);
    return summary;
  }
}
