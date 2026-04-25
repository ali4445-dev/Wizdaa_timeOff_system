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
 */
export class CreateTimeOffRequestDto {
  @IsString()
  @IsNotEmpty()
  employeeId;

  @IsString()
  @IsNotEmpty()
  locationId;

  @IsDateString()
  startDate;

  @IsDateString()
  endDate;

  @IsNumber()
  @IsPositive()
  @Min(0.5)
  duration;
}
