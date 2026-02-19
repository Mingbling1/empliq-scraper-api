import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { ProxyTestService } from '../../../application/services/proxy-test.service';
import {
  TestProxyDto,
  TestProxyResponseDto,
  ProxyPoolStatsResponseDto,
} from '../dtos/proxy.dto';

@ApiTags('Proxies')
@ApiSecurity('x-api-key')
@Controller('proxies')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(private readonly proxyTestService: ProxyTestService) {}

  /**
   * POST /proxies/test
   * Testea un proxy individual contra datosperu.org
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Testear un proxy contra datosperu.org',
    description:
      'Prueba si un proxy SOCKS5/HTTP puede alcanzar datosperu.org sin ' +
      'ser bloqueado por Cloudflare. Retorna tiempo de respuesta.',
  })
  @ApiResponse({ status: 200, type: TestProxyResponseDto })
  async testProxy(@Body() dto: TestProxyDto): Promise<TestProxyResponseDto> {
    const protocol = dto.protocol || 'socks5';
    this.logger.log(`🧪 Testing proxy ${dto.ip}:${dto.port} (${protocol})`);

    const result = await this.proxyTestService.testProxy(
      dto.ip,
      dto.port,
      protocol,
    );

    return {
      success: result.success,
      ip: dto.ip,
      port: dto.port,
      protocol,
      responseMs: result.responseMs,
      error: result.error,
    };
  }

  /**
   * GET /proxies/pool
   * Stats del pool de proxies en memoria
   */
  @Get('pool')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ver estado del pool de proxies en memoria',
    description: 'Retorna cuántos proxies hay en el pool actual del scraper.',
  })
  @ApiResponse({ status: 200, type: ProxyPoolStatsResponseDto })
  async getPoolStats(): Promise<ProxyPoolStatsResponseDto> {
    return this.proxyTestService.getPoolStats();
  }

  /**
   * POST /proxies/refresh
   * Fuerza refresh del pool desde fuentes públicas
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Forzar refresh del pool de proxies',
    description:
      'Re-descarga listas de proxies públicas y prueba cuáles funcionan.',
  })
  async refreshPool(): Promise<{ message: string; previousCount: number }> {
    this.logger.log('🔄 Manual proxy pool refresh requested');
    const previousCount = (await this.proxyTestService.getPoolStats()).totalInPool;
    await this.proxyTestService.refreshProxies();
    return {
      message: 'Proxy pool refresh initiated',
      previousCount,
    };
  }
}
