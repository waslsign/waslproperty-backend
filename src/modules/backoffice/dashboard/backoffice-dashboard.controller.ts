import type { Request, Response } from 'express';
import { getPrismaClient } from '../../../lib/prisma.js';
import { BackofficeDashboardService } from './backoffice-dashboard.service.js';

const dashboardService = new BackofficeDashboardService(getPrismaClient());

export async function getBackofficeDashboard(_req: Request, res: Response) {
  const [metrics, recentActivity] = await Promise.all([
    dashboardService.getMetrics(),
    dashboardService.getRecentActivity(),
  ]);
  res.json({ metrics, recentActivity });
}
