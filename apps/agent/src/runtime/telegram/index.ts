/**
 * Phase 13 — Telegram delivery контракт (чистые функции).
 * telegram-bot слой не изменяется.
 */
export {
  DEFAULT_DELIVERY_POLICY,
  classifyDeliveryError,
  deliveryStatusFromError,
  shouldRetry,
  type DeliveryErrorKind,
  type DeliveryPolicy,
  type DeliveryResult,
  type DeliveryStatus,
  type DeliveryTarget,
  type DeliveryTransport,
} from "./delivery.js";
