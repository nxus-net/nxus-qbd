import { describe, expect, it } from 'vitest';

import type { DataExtDef } from '../../src/index';
import { DataExtensionType } from '../../src/generated/types.gen';

describe('custom field definition response model', () => {
  it('accepts QuickBooks definitions without a DataExtID or format string', () => {
    const definition: DataExtDef = {
      id: null,
      ownerId: '{C3AA84E0-D242-47AB-A12B-3EDA3A2590A2}',
      name: 'Private SDK Field',
      type: DataExtensionType.STR255TYPE,
      assignToObjects: ['OtherName'],
      listRequire: false,
      transactionRequire: false,
      formatString: null,
    };

    expect(definition.id).toBeNull();
    expect(definition.formatString).toBeNull();
  });
});
