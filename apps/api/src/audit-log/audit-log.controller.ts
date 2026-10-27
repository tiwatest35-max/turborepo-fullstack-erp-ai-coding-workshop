import { Controller } from '@nestjs/common';
import { contract } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';

@Controller()
export class AuditLogController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles('MANAGER', 'ADMIN')
  @Implement(contract.auditLog.list)
  list() {
    return implement(contract.auditLog.list).handler(async ({ input }) => {
      const { page, pageSize } = input;
      const [rows, total] = await Promise.all([
        this.prisma.auditLog.findMany({
          include: { actor: { select: { name: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.auditLog.count(),
      ]);

      return {
        items: rows.map((row) => ({
          id: row.id,
          actorId: row.actorId,
          actorName: row.actor.name,
          sourceDocumentType: row.sourceDocumentType,
          sourceDocumentNumber: row.sourceDocumentNumber,
          outcome: row.outcome,
          reason: row.reason,
          createdAt: row.createdAt.toISOString(),
        })),
        page,
        pageSize,
        total,
        hasMore: (page - 1) * pageSize + rows.length < total,
      };
    });
  }
}
