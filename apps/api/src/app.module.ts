import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ORPCModule } from '@orpc/nest';
import { AuthModule } from './auth/auth.module.js';
import { validateEnv } from './config/env.js';
import { ConventionsModule } from './conventions/conventions.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { OpenApiModule } from './openapi/openapi.module.js';
import { ProductsModule } from './products/products.module.js';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module.js';
import { StockModule } from './stock/stock.module.js';
import { StoresModule } from './stores/stores.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Repo-root .env (optional). Real environment variables always take precedence.
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
    ORPCModule.forRoot({}),
    DatabaseModule,
    AuthModule,
    // The reference conventions route is a demonstration only; never expose it
    // (or its OpenAPI entry) in production. Removed once a real list route exists.
    ...(process.env.NODE_ENV === 'production' ? [] : [ConventionsModule]),
    ProductsModule,
    PurchaseOrdersModule,
    StockModule,
    StoresModule,
    SuppliersModule,
    HealthModule,
    OpenApiModule,
  ],
})
export class AppModule {}
