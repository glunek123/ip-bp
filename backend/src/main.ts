import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  if (config.get<string>('NODE_ENV') !== 'production') {
    const definition = new DocumentBuilder()
      .setTitle('知产案件管理系统')
      .setDescription('工程基础接口')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, definition),
    );
  }
  await app.listen(config.getOrThrow<number>('PORT'), '127.0.0.1');
}

void bootstrap().catch(() => {
  console.error(
    'Backend startup failed. Check environment configuration and local port availability.',
  );
  process.exitCode = 1;
});
