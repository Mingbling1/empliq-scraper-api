import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  // Validación global (class-validator)
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // CORS (para n8n y frontend)
  app.enableCors({
    origin: '*',
    methods: 'GET,POST',
  });

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('Empliq Scraper API')
    .setDescription(
      'Microservicio liviano de búsqueda de websites de empresas peruanas. Sin browser engines.\n\n' +
      '**2 estrategias disponibles (HTTP puro, sin browser):**\n' +
      '- `ddg_http` — HTTP directo a DuckDuckGo (rápido, ~1-2s)\n' +
      '- `bing_http` — HTTP directo a Bing (fallback, ~2-4s)\n\n' +
      '**Autenticación:** Header `x-api-key` requerido en todos los endpoints excepto `/search/health`.\n\n' +
      '**Para n8n:** usa `GET /search?q=EMPRESA` con header `x-api-key`.',
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .addTag('Search', 'Endpoints de búsqueda')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.SCRAPER_PORT || 3457;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🚀 Empliq Scraper API corriendo en http://localhost:${port}`);
  logger.log(`📚 Swagger docs en http://localhost:${port}/docs`);
  logger.log(`\n📡 Para n8n: GET http://localhost:${port}/search?q=INTERBANK`);
}

bootstrap();
