import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller.js';

@Module({
  controllers: [SuppliersController],
})
export class SuppliersModule {}
