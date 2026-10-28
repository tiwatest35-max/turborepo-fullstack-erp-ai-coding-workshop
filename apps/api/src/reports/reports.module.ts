import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';

/** Read-only reports over confirmed documents (RPT-01). */
@Module({
  controllers: [ReportsController],
})
export class ReportsModule {}
