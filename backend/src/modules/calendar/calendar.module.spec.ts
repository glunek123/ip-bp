import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CalendarModule } from './calendar.module';
import { CalendarController } from './calendar.controller';

describe('calendar real module wiring', () => {
  it('resolves the real identity guard through module imports without overriding it', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              AUTH_THROTTLE_SECRET: 'synthetic-calendar-module-unit-secret',
              PRIVATE_FILE_ROOT: join(tmpdir(), 'dev-cor-calendar-module-unit'),
            }),
          ],
        }),
        CalendarModule,
      ],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile();
    try {
      expect(module.get(CalendarController)).toBeInstanceOf(CalendarController);
      expect(module.get(ActorContextGuard)).toBeInstanceOf(ActorContextGuard);
    } finally {
      await module.close();
    }
  });
});
