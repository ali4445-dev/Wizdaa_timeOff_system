import { Controller, Get, Post, Body, Param, Query, Logger } from '@nestjs/common';

/**
 * MockHcmController
 *
 * Simulates an external Human Capital Management (HCM) system.
 * In a real scenario, this would be Workday, SAP, etc.
 */
@Controller('mock-hcm')
export class MockHcmController {
  private readonly logger = new Logger(MockHcmController.name);

  // Simple in-memory storage for mock HCM balances
  private balances: Record<string, number> = {
    'emp123:locA': 20,
    'emp456:locB': 10,
    'emp789:locA': 5,
  };

  @Get('balance/:employeeId/:locationId')
  async getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ) {
    const key = `${employeeId}:${locationId}`;
    const balance = this.balances[key] ?? 0;
    
    this.logger.log(`HCM: Fetching balance for ${key} -> ${balance}`);
    
    return {
      employeeId,
      locationId,
      balance,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('deduct')
  async deductBalance(
    @Body() body: { employeeId: string; locationId: string; amount: number },
  ) {
    const key = `${body.employeeId}:${body.locationId}`;
    const current = this.balances[key] ?? 0;

    if (current < body.amount) {
      this.logger.warn(`HCM: Insufficient balance for ${key}. Current: ${current}, Requested: ${body.amount}`);
      return { success: false, error: 'Insufficient balance on HCM' };
    }

    this.balances[key] = current - body.amount;
    this.logger.log(`HCM: Deducted ${body.amount} from ${key}. New balance: ${this.balances[key]}`);

    return { 
      success: true, 
      newBalance: this.balances[key],
      transactionId: `hcm-tx-${Date.now()}` 
    };
  }

  /**
   * Endpoint to simulate independent HCM changes (e.g. Work Anniversary)
   */
  @Post('simulate-bonus')
  async simulateBonus(
    @Body() body: { employeeId: string; locationId: string; amount: number },
  ) {
    const key = `${body.employeeId}:${body.locationId}`;
    this.balances[key] = (this.balances[key] ?? 0) + body.amount;
    this.logger.log(`HCM: Bonus added to ${key}! +${body.amount}. New balance: ${this.balances[key]}`);
    return { success: true, balance: this.balances[key] };
  }
}
