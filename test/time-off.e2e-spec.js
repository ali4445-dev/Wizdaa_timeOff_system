import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { TimeOffRequestStatus } from './../src/time-off/enums/time-off-request-status.enum.js';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';

describe('TimeOff System (e2e Integration)', () => {
  let app;
  const hcmBalances = {};

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
    .overrideProvider(HttpService)
    .useValue({
      get: jest.fn((url) => {
        const parts = url.split('/');
        const locId = parts.pop();
        const empId = parts.pop();
        const key = `${empId}:${locId}`;
        return of({ data: { balance: hcmBalances[key] ?? 0 } });
      }),
      post: jest.fn((url, body) => {
        if (url.includes('deduct')) {
          const key = `${body.employeeId}:${body.locationId}`;
          const current = hcmBalances[key] ?? 0;
          if (current < body.amount) {
            return of({ data: { success: false, error: 'Insufficient HCM balance' } });
          }
          hcmBalances[key] -= body.amount;
          return of({ data: { success: true, transactionId: 'e2e-tx' } });
        }
        return of({ data: { success: true } });
      }),
    })
    .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const empId = `e2e-${Date.now()}`;
  const locId = 'loc-main';

  it('Scenario: Initial Sync -> Request -> Approval -> HCM Update', async () => {
    hcmBalances[`${empId}:${locId}`] = 20;

    await request(app.getHttpServer())
      .post('/sync/batch')
      .send([
        { employeeId: empId, locationId: locId, currentBalance: 20 }
      ])
      .expect(200);

    const balanceRes = await request(app.getHttpServer())
      .get(`/balance/${empId}/${locId}`)
      .expect(200);
    expect(balanceRes.body.data.currentBalance).toBe(20);

    const requestRes = await request(app.getHttpServer())
      .post('/request')
      .send({
        employeeId: empId,
        locationId: locId,
        startDate: '2025-06-01',
        endDate: '2025-06-05',
        duration: 5
      })
      .expect(201);
    
    const requestId = requestRes.body.data.id;
    expect(requestRes.body.data.status).toBe(TimeOffRequestStatus.PENDING);

    await request(app.getHttpServer())
      .post('/request')
      .send({
        employeeId: empId,
        locationId: locId,
        startDate: '2025-07-01',
        endDate: '2025-07-20',
        duration: 16
      })
      .expect(409);

    const approveRes = await request(app.getHttpServer())
      .patch(`/request/${requestId}/status`)
      .send({ status: TimeOffRequestStatus.APPROVED })
      .expect(200);
    
    expect(approveRes.body.data.status).toBe(TimeOffRequestStatus.APPROVED);

    const finalBalanceRes = await request(app.getHttpServer())
      .get(`/balance/${empId}/${locId}`)
      .expect(200);
    
    expect(finalBalanceRes.body.data.currentBalance).toBe(15);
  });
});
