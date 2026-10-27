import { Controller } from '@nestjs/common';
import { apiError, contract, type ExampleItem } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { Public } from '../auth/auth.decorators.js';

/** A fixed set of items, oldest-first in storage order. */
const SEED: ExampleItem[] = Array.from({ length: 25 }, (_, index) => ({
  id: `item-${index + 1}`,
  label: `Example ${index + 1}`,
}));

@Controller()
export class ConventionsController {
  // Reference implementation of a list route using the shared conventions.
  // Lists are newest-first, then sliced by page/pageSize into the envelope.
  @Public()
  @Implement(contract.conventions.list)
  list() {
    return implement(contract.conventions.list).handler(({ input, errors }) => {
      const { page, pageSize } = input;
      const newestFirst = [...SEED].reverse();
      const total = newestFirst.length;
      const lastPage = Math.max(1, Math.ceil(total / pageSize));

      // Demonstrates the standard actionable Thai error: asking for a page past
      // the end is a correct-your-input error, not a raw exception.
      if (page > lastPage) {
        throw errors.BAD_REQUEST({
          data: apiError(
            'PAGE_OUT_OF_RANGE',
            `หน้าที่ขอเกินจำนวนหน้าที่มี (สูงสุด ${lastPage})`,
            'correct_input',
          ),
        });
      }

      const start = (page - 1) * pageSize;
      const items = newestFirst.slice(start, start + pageSize);

      return { items, page, pageSize, total, hasMore: start + items.length < total };
    });
  }
}
