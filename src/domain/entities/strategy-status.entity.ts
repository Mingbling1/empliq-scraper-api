import { SearchStrategy } from '../enums/search-strategy.enum';

/**
 * Estado de una estrategia de búsqueda.
 * Permite al orquestador (y a n8n) saber cuándo cambiar de estrategia.
 */
export class StrategyStatus {
  strategy: SearchStrategy;
  available: boolean;
  usageCount: number;
  maxPerSession: number;
  successCount: number;
  failCount: number;
  consecutiveErrors: number;
  cooldownUntil: Date | null;
  avgResponseTimeMs: number;

  constructor(params: {
    strategy: SearchStrategy;
    maxPerSession: number;
  }) {
    this.strategy = params.strategy;
    this.available = true;
    this.usageCount = 0;
    this.maxPerSession = params.maxPerSession;
    this.successCount = 0;
    this.failCount = 0;
    this.consecutiveErrors = 0;
    this.cooldownUntil = null;
    this.avgResponseTimeMs = 0;
  }

  get remainingCapacity(): number {
    return Math.max(0, this.maxPerSession - this.usageCount);
  }

  get successRate(): number {
    const total = this.successCount + this.failCount;
    return total > 0 ? this.successCount / total : 0;
  }

  get isExhausted(): boolean {
    return this.usageCount >= this.maxPerSession;
  }

  get isInCooldown(): boolean {
    if (!this.cooldownUntil) return false;
    return new Date() < this.cooldownUntil;
  }

  get isAvailable(): boolean {
    return this.available && !this.isExhausted && !this.isInCooldown;
  }

  recordUse(success: boolean, responseTimeMs: number): void {
    this.usageCount++;

    if (success) {
      this.successCount++;
      this.consecutiveErrors = 0;
    } else {
      this.failCount++;
      this.consecutiveErrors++;
    }

    // Promedio móvil del tiempo de respuesta
    const total = this.successCount + this.failCount;
    this.avgResponseTimeMs =
      (this.avgResponseTimeMs * (total - 1) + responseTimeMs) / total;

    // Si hay 3+ errores consecutivos → cooldown de 5 minutos
    if (this.consecutiveErrors >= 3) {
      this.cooldownUntil = new Date(Date.now() + 5 * 60 * 1000);
    }
  }

  reset(): void {
    this.usageCount = 0;
    this.successCount = 0;
    this.failCount = 0;
    this.consecutiveErrors = 0;
    this.cooldownUntil = null;
    this.avgResponseTimeMs = 0;
    this.available = true;
  }
}
