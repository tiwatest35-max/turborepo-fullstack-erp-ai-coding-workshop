import { Module } from '@nestjs/common';
import { ConventionsController } from './conventions.controller.js';

@Module({
  controllers: [ConventionsController],
})
export class ConventionsModule {}
