// AI tool: check whether a proposed set of components is compatible. This
// is a thin, real adapter over the existing Compatibility Engine
// (backend/src/services/buildPc.service.js#validateBuildConfig) — it is the
// *only* function in the entire codebase allowed to decide compatibility.
// An LLM must never be allowed to conclude "these are compatible" on its
// own (task requirement, §3.2); this tool is how it defers that decision.

import { validateBuildConfig } from '../../services/buildPc.service.js';

export const compatibilityToolDefinition = {
  name: 'check_build_compatibility',
  description: 'Kiểm tra một cấu hình PC đề xuất (danh sách linh kiện theo slot) có tương thích với nhau hay không, dùng Compatibility Engine chính thức của cửa hàng — không tự suy luận tương thích.',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Danh sách linh kiện đề xuất.',
        items: {
          type: 'object',
          properties: {
            slot: { type: 'string', description: 'Slot linh kiện, ví dụ "cpu", "mainboard", "ram".' },
            productId: { type: 'number', description: 'ID sản phẩm thực tế trong cửa hàng.' },
            quantity: { type: 'number', description: 'Số lượng.' },
          },
          required: ['slot', 'productId', 'quantity'],
        },
      },
    },
    required: ['items'],
  },
};

/**
 * @param {{ items: { slot: string, productId: number, quantity: number }[] }} args
 * @returns {Promise<ReturnType<typeof validateBuildConfig>>}
 */
export async function checkBuildCompatibility(args = {}) {
  return validateBuildConfig(args.items);
}
