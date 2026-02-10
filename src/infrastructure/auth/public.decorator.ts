import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca un endpoint como público (no requiere x-api-key).
 * Uso: @Public() encima del handler.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
