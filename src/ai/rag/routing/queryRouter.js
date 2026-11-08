import { normalize, identifiers } from '../retrieval/text.js';

/**
 * Lightweight intent detection — replaces classifyQuery for the AI path.
 * Only decides: local fallback? needs RAG? Model decides everything else.
 */
export function detectIntent(message) {
  const msg = normalize(message).trim();
  if (!msg) return { needsRag: false, isLocalPrice: false, isLocalOrder: false, complexity: 'simple', reason: 'empty' };

  const liveText = msg.replace(/\b(danh gia|chuyen gia|huong dan mua hang)\b/g, '');
  const isOrder = /\b(don hang|tracking|ma don|order|tra cuu don|theo doi don|xem don|tinh trang don)\b/.test(msg);
  const isLive = /\b(gia|bao nhieu tien|bao nhieu vay|con hang|het hang|ton kho|mua|dat hang|re nhat|dat nhat|re hon|dat hon|tot nhat|manh nhat|loai nao|con nao|chon ho|tim ho|goi y|tu van)\b/.test(liveText);
  const isPolicy = /\b(bao hanh|doi tra|hoan tien|van chuyen|giao hang|thanh toan|chinh sach|quy dinh|bao mat|dieu khoan|huong dan mua hang)\b/.test(msg);
  const isTechnical = /\b(la gi|khac|so sanh|so voi|nen chon|danh gia|thong so|hieu nang|socket|chipset|fps|render|tdp|watt|cong suat|tuong thich|nang cap)\b/.test(msg);
  const hasSpec = /\bddr[345]\b/.test(msg);
  const hasModel = identifiers(message).length > 0;
  const isComparison = /\b(so sanh|so voi)\b/.test(msg);
  const isBuild = /\b(build pc|rap may|lap may|bo may|cau hinh|combo)\b/.test(msg);

  const isLocalPrice = isLive && !isComparison && !isPolicy && !isBuild && (hasModel || hasSpec);
  const isLocalOrder = isOrder && !isPolicy && !isTechnical;
  const needsRag = (isPolicy || isTechnical) && !isLocalPrice;
  const complexity = /\b(so sanh|so voi|khac|tuong thich)\b/.test(msg) ? 'comparison' : isPolicy ? 'policy' : isTechnical ? 'technical' : 'simple';
  const reason = isLocalPrice ? 'local_price' : isLocalOrder ? 'local_order' : needsRag ? 'needs_rag' : 'ai';

  return { needsRag, isLocalPrice, isLocalOrder, complexity, reason };
}

// Legacy export — kept for test backward-compatibility. Not used by the main AI chat flow.
export function classifyQuery(message, { resolved, context } = {}) {
  const msg = normalize(message).trim();
  const query = normalize(resolved?.query || message);
  const has = pattern => pattern.test(msg);
  const liveText = msg.replace(/\b(danh gia|chuyen gia|huong dan mua hang)\b/g, '');
  const features = {
    order: has(/\b(don hang|tracking|ma don|order)\b/),
    live: /\b(gia|bao nhieu tien|bao nhieu vay|con hang|het hang|ton kho|ngan sach|budget|khuyen mai|sale|mua|dat hang|re hon|dat hon|re nhat|dat nhat|tot nhat|manh nhat|nao re|nao dat)\b/.test(liveText),
    policy: has(/\b(bao hanh|doi tra|hoan tien|van chuyen|giao hang|thanh toan|chinh sach|quy dinh|bao mat|dieu khoan|huong dan mua hang)\b/),
    technical: has(/\b(la gi|khac|so sanh|so voi|nen chon|danh gia|thong so|hieu nang|ho tro|cong nghe|socket|chipset|fps|render|tdp|watt|cong suat|tuong thich|ddr[345]|nang cap)\b/),
    search: has(/\b(tim|goi y|de xuat|recommend|tu van|loai nao|mau nao|con nao)\b/),
    component: /\b(cpu|gpu|vga|card|ram|ssd|hdd|mainboard|bo mach|nguon|psu|tan nhiet|laptop|man hinh|monitor|chuot|mouse|ban phim|keyboard|tai nghe|headset|rtx|gtx|geforce|radeon|intel|amd|ryzen|asus|msi|gigabyte|kingston)\b/.test(query),
    model: identifiers(resolved?.query || message).length > 0 || Boolean(resolved?.entities?.length),
    build: has(/\b(build pc|rap may|lap may|bo may|cau hinh|combo)\b/),
  };
  const result = (route, reason, toolNames = []) => ({ route, reason, toolNames, features,
    complexity: has(/\b(so sanh|so voi|khac|tuong thich)\b/) ? 'comparison' : features.policy ? 'policy' : features.technical ? 'technical' : 'simple' });
  if (!msg) return result('none', 'empty');
  if (resolved?.ambiguous) return result('none', 'ambiguous_reference');

  const purePrice = features.live && !features.technical && !features.search && !features.build && !features.policy;
  const pureOrder = features.order && !features.policy && !features.technical;
  if (pureOrder && (context === 'order_lookup' || has(/\b(tra cuu|theo doi|tracking|ma don|tinh trang don|xem don|don hang)\b/))) {
    return result('local_only', 'local_order_lookup', ['lookup_my_orders']);
  }
  if (purePrice && (features.model || features.component) && !has(/\b(so sanh|so voi|nen chon|tu van|goi y|tot nhat|re nhat|dat nhat|manh nhat)\b/)) {
    return result('local_only', 'local_price_lookup', ['search_products']);
  }

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
  if (knowledge && domain) return result('rag_and_fc', 'technical_knowledge', ['search_products']);
  if (domain) return result('rag_and_fc', 'product_knowledge', ['search_products']);
  return result('none', 'conversation_or_out_of_domain');
}
