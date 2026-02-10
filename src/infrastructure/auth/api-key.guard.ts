import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Guard que valida el header x-api-key contra la variable API_KEY.
 *
 * Todos los endpoints son protegidos por defecto.
 * Usa @Public() para excluir un endpoint (ej: healthcheck).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    this.apiKey = this.config.get<string>('API_KEY', '');
    if (!this.apiKey) {
      this.logger.warn(
        '⚠️  API_KEY no configurada — todos los requests serán rechazados.',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    // Verificar si el endpoint está marcado como público
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const key = request.headers['x-api-key'];

    if (!this.apiKey) {
      throw new UnauthorizedException('API_KEY no configurada en el servidor');
    }

    if (!key) {
      throw new UnauthorizedException('Header x-api-key requerido');
    }

    if (key !== this.apiKey) {
      this.logger.warn(`🚫 API Key inválida desde ${request.ip}`);
      throw new UnauthorizedException('API Key inválida');
    }

    return true;
  }
}
