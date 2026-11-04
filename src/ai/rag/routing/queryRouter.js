import { normalize, identifiers } from '../retrieval/text.js';

// Explainable intent features + resolved conversation entities. Zero model calls.
export function classifyQuery(message, { resolved, context } = {}) {
  const msg = normalize(message).trim();
  const query = normalize(resolved?.query || message);
  const has = pattern => pattern.test(msg);
  // "đánh giá" is a review; "hướng dẫn mua hàng" is a policy, not a price lookup.
  const liveText = msg.replace(/\b(danh gia|chuyen gia|huong dan mua hang)\b/g, '');
  const features = {
    order: has(/\b(don hang|tracking|ma don|order)\b/),
    live: /\b(gia|bao nhieu tien|bao nhieu vay|con hang|het hang|ton kho|ngan sach|budget|khuyen mai|sale|mua|dat hang|re hon|dat hon|re nhat)\b/.test(liveText),
    policy: has(/\b(bao hanh|doi tra|hoan tien|van chuyen|giao hang|thanh toan|chinh sach|quy dinh|bao mat|dieu khoan|huong dan mua hang)\b/),
    technical: has(/\b(la gi|khac|so sanh|so voi|nen chon|danh gia|thong so|hieu nang|ho tro|cong nghe|socket|chipset|fps|render|tdp|watt|cong suat|tuong thich|ddr[345]|nang cap)\b/),
    search: has(/\b(tim|goi y|de xuat|recommend|tu van|loai nao|mau nao|con nao)\b/),
    component: /\b(cpu|gpu|vga|ram|ssd|hdd|mainboard|bo mach|nguon|psu|tan nhiet|laptop|man hinh|chuot|ban phim|rtx|intel|amd|ryzen|asus|msi|gigabyte|kingston)\b/.test(query),
    model: identifiers(resolved?.query || message).length > 0 || Boolean(resolved?.entities?.length),
    build: has(/\b(build pc|rap may|lap may|bo may|cau hinh|combo)\b/),
  };
  const result = (route, reason, toolNames = []) => ({ route, reason, toolNames, features,
    complexity: has(/\b(so sanh|so voi|khac|tuong thich)\b/) ? 'comparison' : features.policy ? 'policy' : features.technical ? 'technical' : 'simple' });
  if (!msg) return result('none', 'empty');
  if (resolved?.ambiguous) return result('none', 'ambiguous_reference');
  const orderLookup = context === 'order_lookup' || features.order && (!features.policy || has(/\b(tra cuu|theo doi|tracking|ma don|tinh trang don|xem don)\b/));
  if (orderLookup) return result(features.policy ? 'rag_and_fc' : 'fc_only', 'order_lookup', ['lookup_my_orders']);
  const domain = features.component || features.model || features.build || features.policy;
  const knowledge = features.technical || features.policy;
  if (features.build) return result('rag_and_fc', 'build_pc', ['search_products', 'check_build_compatibility']);
  if (features.live && (knowledge || features.search && domain)) return result('rag_and_fc', 'knowledge_and_live', ['search_products']);
  if (features.live && (domain || resolved?.rewritten)) return result('fc_only', 'live_product', ['search_products']);
  if (features.policy) return result('rag_only', 'policy_question');
  if (has(/\btuong thich\b/) && domain) return result('rag_and_fc', 'compatibility', ['search_products', 'check_build_compatibility']);
  if (features.search && domain) return result('rag_and_fc', 'product_advice', ['search_products']);
  if (knowledge && domain) return result('rag_only', 'technical_knowledge');
  if (domain) return result('rag_only', 'product_knowledge');
  return result('none', 'conversation_or_out_of_domain');
}
