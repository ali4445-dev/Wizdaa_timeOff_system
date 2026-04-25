import { Controller, Get, Post, Body, Param, Query, Logger, Bind } from '@nestjs/common';

/**
 * MockHcmController
 */
@Controller('mock-hcm')
export class MockHcmController {
  private readonly logger = new Logger(MockHcmController.name);

  constructor() {
    this.balances = {
      'emp123:locA': 20,
      'emp456:locB': 10,
      'emp789:locA': 5,
    };
  }

  @Get('balance/:employeeId/:locationId')
  @Bind(Param('employeeId'), Param('locationId'))
  async getBalance(employeeId, locationId) {
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
  @Bind(Body())
  async deductBalance(body) {
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

  @Post('simulate-bonus')
  @Bind(Body())
  async simulateBonus(body) {
    const key = `${body.employeeId}:${body.locationId}`;
    this.balances[key] = (this.balances[key] ?? 0) + body.amount;
    this.logger.log(`HCM: Bonus added to ${key}! +${body.amount}. New balance: ${this.balances[key]}`);
    return { success: true, balance: this.balances[key] };
  }
}
