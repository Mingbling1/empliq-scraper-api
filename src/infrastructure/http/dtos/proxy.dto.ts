import { IsString, IsInt, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TestProxyDto {
  @ApiProperty({ description: 'Proxy IP address', example: '192.111.134.10' })
  @IsString()
  ip: string;

  @ApiProperty({ description: 'Proxy port', example: 4145 })
  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @ApiPropertyOptional({
    description: 'Proxy protocol',
    example: 'socks5',
    default: 'socks5',
  })
  @IsString()
  @IsOptional()
  protocol?: string;
}

export class TestProxyResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty() ip: string;
  @ApiProperty() port: number;
  @ApiProperty() protocol: string;
  @ApiPropertyOptional() responseMs?: number;
  @ApiPropertyOptional() error?: string;
}

export class ProxyPoolStatsResponseDto {
  @ApiProperty() totalInPool: number;
  @ApiProperty() seedCount: number;
  @ApiProperty() directMode: boolean;
  @ApiProperty({ type: [String] }) sampleProxies: string[];
}
