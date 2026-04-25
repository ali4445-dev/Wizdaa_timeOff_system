import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

/**
 * DTO for upserting (creating or updating) a balance record.
 * Used by batch sync from HCM and admin operations.
 */
export class UpsertBalanceDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  /**
   * The new balance value (in days).
   * Set by HCM during sync. Must be non-negative.
   */
  @IsNumber()
  @Min(0)
  currentBalance!: number;
}
