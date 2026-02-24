/**
 * Puerto para almacenamiento de archivos en Object Storage.
 */
export interface StoragePort {
  /**
   * Sube un archivo al bucket.
   * @returns URL pública del archivo subido.
   */
  uploadFile(
    file: Buffer,
    fileName: string,
    folder: string,
    contentType: string,
  ): Promise<{ url: string; objectName: string }>;

  /**
   * Verifica si el servicio de almacenamiento está configurado.
   */
  isConfigured(): boolean;
}

export const STORAGE_PORT = Symbol('STORAGE_PORT');
