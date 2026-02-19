import { Injectable, Logger, Inject } from '@nestjs/common';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as https from 'https';
import { DATOS_PERU_ENRICHMENT_PORT } from '../../domain/ports/datos-peru-enrichment.port';
import type { DatosPeruHttpAdapter } from '../../infrastructure/adapters/datos-peru-http.adapter';

const TEST_URL = 'https://www.datosperu.org';
const TIMEOUT_MS = 12000;

@Injectable()
export class ProxyTestService {
  private readonly logger = new Logger(ProxyTestService.name);

  constructor(
    @Inject(DATOS_PERU_ENRICHMENT_PORT)
    private readonly datosPeruAdapter: DatosPeruHttpAdapter,
  ) {}

  /**
   * Test a single proxy by making a request to datosperu.org
   */
  async testProxy(
    ip: string,
    port: number,
    protocol: string,
  ): Promise<{ success: boolean; responseMs?: number; error?: string }> {
    const proxyUrl = `socks5h://${ip}:${port}`;
    const start = Date.now();

    try {
      const agent = new SocksProxyAgent(proxyUrl);

      const result = await new Promise<{ statusCode: number; body: string }>(
        (resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Timeout')),
            TIMEOUT_MS,
          );

          const req = https.get(
            TEST_URL,
            {
              agent,
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept:
                  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
              },
              timeout: TIMEOUT_MS,
            },
            (res) => {
              let body = '';
              res.on('data', (chunk) => (body += chunk));
              res.on('end', () => {
                clearTimeout(timer);
                resolve({ statusCode: res.statusCode || 0, body });
              });
            },
          );
          req.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
          });
        },
      );

      const elapsed = Date.now() - start;

      // Check if we got a real page (not Cloudflare challenge)
      if (
        result.body.includes('Just a moment') ||
        result.body.includes('cf-browser-verification')
      ) {
        return {
          success: false,
          responseMs: elapsed,
          error: 'Cloudflare blocked',
        };
      }

      if (result.statusCode === 200 && result.body.length > 5000) {
        return { success: true, responseMs: elapsed };
      }

      return {
        success: false,
        responseMs: elapsed,
        error: `HTTP ${result.statusCode}, body ${result.body.length} bytes`,
      };
    } catch (err: any) {
      const elapsed = Date.now() - start;
      return {
        success: false,
        responseMs: elapsed,
        error: err.message || 'Unknown error',
      };
    }
  }

  /**
   * Get current in-memory proxy pool stats from the DatosPeru adapter
   */
  async getPoolStats(): Promise<{
    totalInPool: number;
    seedCount: number;
    directMode: boolean;
    sampleProxies: string[];
  }> {
    // Access adapter internals (it's the same instance)
    const adapter = this.datosPeruAdapter as any;
    const proxies: string[] = adapter.proxies || [];
    return {
      totalInPool: proxies.length,
      seedCount: 5,
      directMode: adapter.directMode || false,
      sampleProxies: proxies.slice(0, 5),
    };
  }

  /**
   * Trigger proxy refresh on the adapter
   */
  async refreshProxies(): Promise<void> {
    const adapter = this.datosPeruAdapter as any;
    if (typeof adapter.refreshProxies === 'function') {
      await adapter.refreshProxies();
    }
  }
}
