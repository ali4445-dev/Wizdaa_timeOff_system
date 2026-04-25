import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsNumber,
  IsPositive,
  Min,
} from 'class-validator';

/**
 * DTO for creating a new time-off request.
 * Validated at the controller level before any business logic runs.
 * This is the first layer of the defensive design.
 */
export class CreateTimeOffRequestDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  /**
   * Start date of leave in ISO 8601 format (YYYY-MM-DD).
   */
  @IsDateString()
  startDate!: string;

  /**
   * End date of leave in ISO 8601 format (YYYY-MM-DD).
   * Must be >= startDate (validated in service layer).
   */
  @IsDateString()
  endDate!: string;

  /**
   * Number of leave days requested.
   * Must be positive. Supports fractional values (e.g., 0.5 for half-day).
   */
  @IsNumber()
  @IsPositive()
  @Min(0.5)
  duration!: number;
}
