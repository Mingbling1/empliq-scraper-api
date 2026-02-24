import {
  Controller,
  Get,
  Query,
  Logger,
  UsePipes,
  ValidationPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { LogoService, LogoFetchResult } from '../../../application/services/logo.service';
import { LogoFetchResponseDto } from '../dtos/logo.dto';

@ApiTags('Logo')
@ApiSecurity('x-api-key')
@Controller('logo')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class LogoController {
  private readonly logger = new Logger(LogoController.name);

  constructor(private readonly logoService: LogoService) {}

  /**
   * GET /logo/fetch?domain=alicorp.com.pe&ruc=20100055237&name=Alicorp
   *
   * Descarga el logo de una empresa, lo sube a Oracle Object Storage,
   * y devuelve la URL pública del bucket.
   *
   * Flujo de búsqueda (se detiene en el primer éxito):
   * 1. logo.dev por dominio (si se proporcionó domain)
   * 2. logo.dev por nombre comercial (si se proporcionó name)
   * 3. Brandfetch por dominio (si se proporcionó domain)
   *
   * Al menos uno de `domain` o `name` es requerido.
   *
   * Proveedores:
   * - Primario: logo.dev (500K free/mes)
   * - Fallback: Brandfetch (100 free total)
   */
  @Get('fetch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Descargar logo de empresa y subirlo al bucket',
    description:
      'Dado un dominio y/o nombre comercial, descarga el logo desde logo.dev (primario) o Brandfetch (fallback), ' +
      'lo sube a Oracle Object Storage, y devuelve la URL pública.\n\n' +
      'Se puede buscar por dominio, por nombre comercial, o ambos (intenta dominio primero, luego nombre).\n\n' +
      'Diseñado para ser llamado desde n8n en el pipeline de enriquecimiento.',
  })
  @ApiQuery({
    name: 'domain',
    description: 'Dominio de la empresa (opcional si se da name)',
    example: 'alicorp.com.pe',
    required: false,
  })
  @ApiQuery({
    name: 'ruc',
    description: 'RUC de la empresa (opcional, para nombrar el archivo)',
    example: '20100055237',
    required: false,
  })
  @ApiQuery({
    name: 'name',
    description: 'Nombre comercial de la empresa (opcional si se da domain)',
    example: 'Alicorp',
    required: false,
  })
  @ApiResponse({
    status: 200,
    type: LogoFetchResponseDto,
    description: 'Resultado de la operación de descarga y almacenamiento del logo',
  })
  async fetchLogo(
    @Query('domain') domain?: string,
    @Query('ruc') ruc?: string,
    @Query('name') name?: string,
  ): Promise<LogoFetchResponseDto> {
    this.logger.log(
      `🖼️  Logo request:${domain ? ` domain=${domain}` : ''}${name ? ` name=${name}` : ''}${ruc ? ` ruc=${ruc}` : ''}`,
    );

    // Validar que al menos uno de domain o name esté presente
    const hasDomain = domain && domain.trim().length > 0;
    const hasName = name && name.trim().length > 0;

    if (!hasDomain && !hasName) {
      return {
        success: false,
        domain: domain || '',
        name: name || null,
        provider: null,
        bucketUrl: null,
        objectName: null,
        format: null,
        sizeBytes: null,
        durationMs: 0,
        error: 'Se requiere al menos domain o name',
      };
    }

    // Limpiar dominio: quitar protocolo y trailing slash
    const cleanDomain = hasDomain
      ? domain
          .trim()
          .replace(/^https?:\/\//, '')
          .replace(/\/+$/, '')
          .toLowerCase()
      : undefined;

    const cleanName = hasName ? name.trim() : undefined;

    const result: LogoFetchResult = await this.logoService.fetchAndStoreLogo(
      cleanDomain,
      ruc,
      cleanName,
    );

    return result;
  }
}
