import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoragePort } from '../../domain/ports/storage.port';

/**
 * Adaptador de almacenamiento para Oracle Object Storage.
 * Usa PAR (Pre-Authenticated Request) para subir archivos sin SDK.
 *
 * Configuración requerida:
 * - ORACLE_PAR_UPLOAD_URL: URL del PAR con permisos de escritura
 * - ORACLE_PUBLIC_URL_BASE: URL base pública para acceder a los objetos
 */
@Injectable()
export class OracleStorageAdapter implements StoragePort {
  private readonly logger = new Logger(OracleStorageAdapter.name);
  private readonly parUploadUrl: string;
  private readonly publicUrlBase: string;

  constructor(private readonly config: ConfigService) {
    this.parUploadUrl = this.config.get<string>('ORACLE_PAR_UPLOAD_URL', '');
    this.publicUrlBase = this.config.get<string>('ORACLE_PUBLIC_URL_BASE', '');

    if (!this.parUploadUrl || !this.publicUrlBase) {
      this.logger.warn(
        '⚠️  Oracle Storage no configurado — ORACLE_PAR_UPLOAD_URL y/o ORACLE_PUBLIC_URL_BASE faltantes.',
      );
    } else {
      this.logger.log('✅ Oracle Object Storage configurado correctamente.');
    }
  }

  async uploadFile(
    file: Buffer,
    fileName: string,
    folder: string,
    contentType: string,
  ): Promise<{ url: string; objectName: string }> {
    if (!this.isConfigured()) {
      throw new Error('Oracle Storage no configurado');
    }

    const objectName = `${folder}/${fileName}`;
    const uploadUrl = `${this.parUploadUrl}${objectName}`;

    this.logger.log(`📤 Subiendo ${objectName} (${file.length} bytes, ${contentType})`);

    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': contentType,
          'Content-Length': file.length.toString(),
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Sin detalle');
        throw new Error(`Upload failed: ${response.status} ${response.statusText} — ${errorText}`);
      }

      const publicUrl = `${this.publicUrlBase}${objectName}`;

      this.logger.log(`✅ Archivo subido: ${publicUrl}`);

      return { url: publicUrl, objectName };
    } catch (error) {
      this.logger.error(`❌ Error subiendo ${objectName}: ${error}`);
      throw error;
    }
  }

  isConfigured(): boolean {
    return !!this.parUploadUrl && !!this.publicUrlBase;
  }
}
