import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

/**
 * DTO for upserting (creating or updating) a balance record.
 */
export class UpsertBalanceDto {
  @IsString()
  @IsNotEmpty()
  employeeId;

  @IsString()
  @IsNotEmpty()
  locationId;

  @IsNumber()
  @Min(0)
  currentBalance;
}
