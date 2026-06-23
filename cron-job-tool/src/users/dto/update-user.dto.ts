import { IsEmail, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(50)
  email!: string;
}
