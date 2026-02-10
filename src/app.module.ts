import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { SearchModule } from './infrastructure/http/search.module';
import { scraperConfig } from './shared/config/scraper.config';
import { ApiKeyGuard } from './infrastructure/auth/api-key.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [scraperConfig],
      envFilePath: ['.env', '.env.local'],
    }),
    SearchModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
