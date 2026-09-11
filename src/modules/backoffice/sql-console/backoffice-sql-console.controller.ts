import type { Request, Response } from 'express';
import { getPrismaClient } from '../../../lib/prisma.js';
import { paginationQuerySchema } from '../../../lib/pagination.js';
import { UnauthorizedError } from '../../../errors/AppError.js';
import { BackofficeSqlConsoleService } from './backoffice-sql-console.service.js';
import { executeSqlSchema } from './backoffice-sql-console.schemas.js';
import { env } from '../../../config/env.js';

const service = new BackofficeSqlConsoleService(getPrismaClient());

export async function getSqlConsoleConfig(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  res.json({
    environment: env.NODE_ENV,
    rawSqlEnabled: env.BACKOFFICE_RAW_SQL_ENABLED,
    writeEnabled: env.BACKOFFICE_RAW_SQL_WRITE_ENABLED,
    unmaskedPiiEnabled: env.BACKOFFICE_RAW_SQL_UNMASKED_PII_ENABLED,
    statementTimeoutMs: env.BACKOFFICE_SQL_STATEMENT_TIMEOUT_MS,
    resultRowLimit: env.BACKOFFICE_SQL_RESULT_ROW_LIMIT,
    canViewUnmaskedPii: req.platformAuth.platformCapabilities.includes('database.sql.pii.unmasked'),
    canWrite: req.platformAuth.platformCapabilities.includes('database.sql.write'),
  });
}

export async function executeSqlStatement(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  const input = executeSqlSchema.parse(req.body);
  const result = await service.execute(
    input,
    { employeeId: req.platformAuth.employeeId, platformRole: req.platformAuth.platformRole },
    req.platformAuth.platformCapabilities,
  );
  res.json(result);
}

export async function listSqlConsoleHistory(req: Request, res: Response) {
  const query = paginationQuerySchema.parse(req.query);
  res.json(await service.listHistory(query));
}
